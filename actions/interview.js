"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai"; // ✅ updated import

// ✅ Updated Gemini initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Helper: extract plain text from different SDK response shapes
function extractResponseText(response) {
  if (!response) return "";
  // Newer @google/genai uses output_text
  if (typeof response.output_text === "string") return response.output_text;
  // Some SDK shapes embed text under output?.[0]?.content?.text
  if (response.output?.[0]?.content?.text) return response.output[0].content.text;
  // Older pattern: response.output[0].text
  if (response.output?.[0]?.text) return response.output[0].text;
  // Fallback: response.candidates[0].content.text
  if (response.candidates?.[0]?.content?.text)
    return response.candidates[0].content.text;
  // Last resort: response.response?.text()
  try {
    if (response.response && typeof response.response.text === "function")
      return response.response.text();
  } catch (e) {
    // ignore
  }
  return "";
}

// Try to parse JSON from text in a tolerant way
function tryParseJSONFromText(text) {
  if (!text) return null;
  // direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // try to extract the first {...} block
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const sub = text.slice(first, last + 1);
      try {
        return JSON.parse(sub);
      } catch (e2) {
        // continue to fallback
      }
    }
  }

  // try to parse a loose multiple-choice format into JSON
  try {
    const groups = text
      .split(/\n\s*\n/) // blank-line separated
      .map((g) => g.trim())
      .filter(Boolean);

    const questions = [];
    for (const g of groups) {
      // look for a question line
      const lines = g.split(/\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      const qLine = lines[0].replace(/^[0-9]+[).\s-]*/,'').replace(/^Q\d+[:.\s]*/i, '').trim();
      const opts = [];
      for (let i = 1; i < lines.length && opts.length < 4; i++) {
        const m = lines[i].match(/^[A-Da-d][).\-\s]+(.*)$/);
        if (m) opts.push(m[1].trim());
        else if (/^[\-\*]\s+/.test(lines[i])) opts.push(lines[i].replace(/^[\-\*]\s+/, '').trim());
        else if (/^[a-d]\)/i.test(lines[i])) opts.push(lines[i].replace(/^[a-d][)\.\s]+/i, '').trim());
      }
      if (qLine && opts.length >= 2) {
        questions.push({ question: qLine, options: opts.slice(0, 4), correctAnswer: opts[0], explanation: "" });
      }
    }
    if (questions.length > 0) return { questions };
  } catch (e) {
    // ignore and fallback
  }

  return null;
}

function fallbackQuestionsForIndustry(industry, skills = []) {
  const base = [
    {
      question: `What is a common core concept in ${industry} work?`,
      options: ["Foundational concept A", "Foundational concept B", "Foundational concept C", "Foundational concept D"],
      correctAnswer: "Foundational concept A",
      explanation: "Start with the fundamentals and build toward applied scenarios.",
    },
    {
      question: `Which tool or technique is commonly used for ${industry} tasks?`,
      options: ["Tool A", "Tool B", "Tool C", "Tool D"],
      correctAnswer: "Tool A",
      explanation: "Practice with Tool A in small projects.",
    },
    {
      question: `What's important when demonstrating ${skills?.slice(0,2).join(', ') || 'relevant'} on your resume?`,
      options: ["Quantify impact", "List responsibilities only", "Use long paragraphs", "Avoid metrics"],
      correctAnswer: "Quantify impact",
      explanation: "Hiring managers value measurable impact and outcomes.",
    },
  ];

  // ensure we return 5 questions: replicate or slightly vary
  while (base.length < 10) base.push({ ...base[base.length - 1] });
  return base.slice(0, 10).map((q) => ({ ...q }));
}

export async function generateQuiz() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      industry: true,
      skills: true,
    },
  });

  if (!user) throw new Error("User not found");

  const prompt = `
    Generate 10 technical interview questions for a ${user.industry} professional${
    user.skills?.length ? ` with expertise in ${user.skills.join(", ")}` : ""
  }.
    
    Each question should be multiple choice with 4 options.
    
    Return the response in this JSON format only, no additional text:
    {
      "questions": [
        {
          "question": "string",
          "options": ["string", "string", "string", "string"],
          "correctAnswer": "string",
          "explanation": "string"
        }
      ]
    }
  `;

  try {
    // Fetch user's previously asked questions — only the most recent questions
    // We'll collect up to the last 10 question texts (most recent) and avoid repeating them.
    const prevAssessments = await db.assessment.findMany({
      where: { userId: user.id },
      select: { questions: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20, // fetch some recent assessments to collect at least 10 questions
    });

    const recentQuestions = [];
    for (const a of prevAssessments) {
      if (!a.questions) continue;
      for (const q of a.questions) {
        try {
          const text = (typeof q.question === "string" ? q.question : JSON.stringify(q.question)).trim();
          recentQuestions.push(text);
          if (recentQuestions.length >= 10) break;
        } catch (e) {
          // ignore malformed entries
        }
      }
      if (recentQuestions.length >= 10) break;
    }

    const prevQuestionsSet = new Set(recentQuestions.map((t) => t.replace(/\s+/g, " ").toLowerCase()));

    // Helper to normalize question text
    const normalize = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

    // Function to call AI and extract questions
    const callAiForQuestions = async (extraPrompt = "") => {
      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt + "\n" + extraPrompt }] }],
      });
      const text = (extractResponseText(resp) || "").trim();
      const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = tryParseJSONFromText(cleanedText);
      if (parsed && parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
      return null;
    };

    // First attempt: call AI normally
    let aiQuestions = null;
    aiQuestions = await callAiForQuestions();

    // Collect unique questions avoiding previously answered ones
    const selected = [];
    const seen = new Set();

    if (aiQuestions && Array.isArray(aiQuestions)) {
      for (const q of aiQuestions) {
        const n = normalize(q.question);
        if (!prevQuestionsSet.has(n) && !seen.has(n)) {
          selected.push(q);
          seen.add(n);
        }
        if (selected.length >= 10) break;
      }
    }

    // If we don't have 10 unique/new questions, attempt one more AI call instructing to avoid previous questions
    if (selected.length < 10) {
      const prevList = Array.from(prevQuestionsSet).slice(0, 50).map((t) => `- ${t}`).join("\n");
      const extraPrompt = `Avoid repeating the user's previously asked questions. Previously asked questions:\n${prevList}\n\nPlease generate questions that are different from the ones above.`;
      const aiRetry = await callAiForQuestions(extraPrompt);
      if (aiRetry && Array.isArray(aiRetry)) {
        for (const q of aiRetry) {
          const n = normalize(q.question);
          if (!prevQuestionsSet.has(n) && !seen.has(n)) {
            selected.push(q);
            seen.add(n);
          }
          if (selected.length >= 10) break;
        }
      }
    }

    // If still short, fill with fallback industry questions (ensuring uniqueness)
    if (selected.length < 10) {
      const fallback = fallbackQuestionsForIndustry(user.industry, user.skills);
      for (const q of fallback) {
        const n = normalize(q.question);
        if (!seen.has(n)) {
          selected.push(q);
          seen.add(n);
        }
        if (selected.length >= 10) break;
      }
    }

    // As a last resort, if still short, include previously asked questions (but dedup locally)
    if (selected.length < 10) {
      // gather any AI returns (first call) and pick ones not already in seen
      const pool = (aiQuestions || []).concat([]);
      for (const q of pool) {
        const n = normalize(q.question);
        if (!seen.has(n)) {
          selected.push(q);
          seen.add(n);
        }
        if (selected.length >= 10) break;
      }
    }

    // Ensure length 10
    return selected.slice(0, 10);
  } catch (error) {
    console.error("Error generating quiz:", error);
    // Return a fallback instead of failing completely
    const fallback = fallbackQuestionsForIndustry(user?.industry || "the field", user?.skills || []);
    return fallback;
  }
}

export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

  // Get wrong answers
  const wrongAnswers = questionResults.filter((q) => !q.isCorrect);

  // Only generate improvement tips if there are wrong answers
  let improvementTip = null;
  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"\nCorrect Answer: "${q.answer}"\nUser Answer: "${q.userAnswer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
      The user got the following ${user.industry} technical interview questions wrong:

      ${wrongQuestionsText}

      Based on these mistakes, provide a concise, specific improvement tip.
      Focus on the knowledge gaps revealed by these wrong answers.
      Keep the response under 2 sentences and make it encouraging.
      Don't explicitly mention the mistakes, instead focus on what to learn/practice.
    `;

    try {
      // ✅ Updated Gemini API call for improvement tip
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: improvementPrompt }] }],
      });

      improvementTip = (extractResponseText(response) || "").trim();
      console.log(improvementTip);
    } catch (error) {
      console.error("Error generating improvement tip:", error);
      // Continue without improvement tip if generation fails
    }
  }

  try {
    const assessment = await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });

    return assessment;
  } catch (error) {
    console.error("Error saving quiz result:", error);
    throw new Error("Failed to save quiz result");
  }
}

export async function getAssessments() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const assessments = await db.assessment.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return assessments;
  } catch (error) {
    console.error("Error fetching assessments:", error);
    throw new Error("Failed to fetch assessments");
  }
}
