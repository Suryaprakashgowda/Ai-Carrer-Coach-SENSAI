"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Helper: robustly extract text from various SDK response shapes
function extractTextFromModelResponse(res) {
  if (!res) return "";

  // raw string
  if (typeof res === "string") return res.trim();

  // older genai: response.output_text
  if (res.output_text && typeof res.output_text === "string")
    return res.output_text.trim();

  // some SDK variants expose .text() on the response wrapper
  try {
    if (res.text && typeof res.text === "function") return res.text().trim();
    if (res.response && typeof res.response.text === "function")
      return res.response.text().trim();
  } catch (e) {
    // ignore
  }

  // candidate/parts shape
  const candidates = res.response?.candidates || res.candidates || [];
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0];
    const parts = first?.content?.parts || first?.content || [];
    if (Array.isArray(parts) && parts.length > 0) {
      const joined = parts.map((p) => p?.text || p?.content || "").join("");
      if (joined.trim()) return joined.trim();
    }
  }

  return "";
}

export async function generateCoverLetter(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  // Build the dynamic prompt
  const prompt = `
Write a professional cover letter for a ${data.jobTitle} position at ${data.companyName}.

About the candidate:
- Industry: ${user.industry}
- Years of Experience: ${user.experience}
- Skills: ${user.skills?.join(", ")}
- Professional Background: ${user.bio}

Job Description:
${data.jobDescription}

Requirements:
1. Use a professional, enthusiastic tone  
2. Highlight relevant skills and experience  
3. Show understanding of the company's needs  
4. Keep it concise (max 400 words)  
5. Use proper business letter formatting in markdown  
6. Include specific examples of achievements  
7. Relate candidate's background to job requirements  

Format the letter in markdown.
`;

  try {
    // Call Gemini (GenAI) SDK
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const content = extractTextFromModelResponse(response) || "";

    // If the model returned empty content, log debug info and save an error record
    const status = content ? "completed" : "error";
    if (!content) {
      console.error("generateCoverLetter: empty model response:", {
        responseSample: JSON.stringify(response).slice(0, 2000),
      });
    }

    // Save generated content (or a visible error placeholder) to DB so we can inspect failures
    const coverLetter = await db.coverLetter.create({
      data: {
        content: content || "[generation failed — see server logs for raw response]",
        jobDescription: data.jobDescription,
        companyName: data.companyName,
        jobTitle: data.jobTitle,
        status,
        userId: user.id,
      },
    });

    return coverLetter;
  } catch (error) {
    console.error("Error generating cover letter:", error);
    throw new Error("Failed to generate cover letter");
  }
}

export async function getCoverLetters() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  return await db.coverLetter.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCoverLetter(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  return await db.coverLetter.findUnique({
    where: {
      id,
      userId: user.id,
    },
  });
}

export async function deleteCoverLetter(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  return await db.coverLetter.delete({
    where: {
      id,
      userId: user.id,
    },
  });
}
