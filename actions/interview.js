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
    // ✅ Updated Gemini API call
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // Robust response extraction
    const text = (extractResponseText(response) || "").trim();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    // Attempt tolerant JSON parsing or structured extraction
    const parsed = tryParseJSONFromText(cleanedText);
    if (parsed && parsed.questions && Array.isArray(parsed.questions)) {
      return parsed.questions;
    }

    console.warn("Could not parse AI JSON for quiz. Raw output:\n", cleanedText);

    // As a last resort, return a programmatic fallback quiz based on industry
    const fallback = fallbackQuestionsForIndustry(user.industry, user.skills);
    return fallback;
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
