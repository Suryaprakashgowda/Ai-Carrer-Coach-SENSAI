"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { GoogleGenAI } from "@google/genai";
import { dbLimit } from "@/lib/dbLimit";

// Initialize the new Gemini SDK client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Helper: robustly extract text from various SDK response shapes
function extractTextFromModelResponse(res) {
  if (!res) return "";
  if (typeof res === "string") return res.trim();
  if (res.output_text && typeof res.output_text === "string")
    return res.output_text.trim();
  try {
    if (res.text && typeof res.text === "function") return res.text().trim();
    if (res.response && typeof res.response.text === "function")
      return res.response.text().trim();
  } catch (e) {
    // ignore
  }
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

// Save or update resume content
export async function saveResume(content) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await dbLimit(() => db.user.findUnique({
    where: { clerkUserId: userId },
  }));
  if (!user) throw new Error("User not found");

  try {
    const resume = await dbLimit(() => db.resume.upsert({
      where: { userId: user.id },
      update: { content },
      create: { userId: user.id, content },
    }));

    revalidatePath("/resume");
    return resume;
  } catch (error) {
    console.error("Error saving resume:", error);
    throw new Error("Failed to save resume");
  }
}

// Retrieve the user's saved resume
export async function getResume() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  return await db.resume.findUnique({
    where: { userId: user.id },
  });
}

// AI-powered improvement of resume sections
export async function improveWithAI({ current, type }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: { industryInsight: true },
  });
  if (!user) throw new Error("User not found");

  const prompt = `
As an expert resume writer, improve the following ${type} description for a ${user.industry} professional.
Make it more impactful, quantifiable, and aligned with industry standards.

Current content: "${current}"

Requirements:
1. Use action verbs
2. Include metrics and results where possible
3. Highlight relevant technical skills
4. Keep it concise but detailed
5. Focus on achievements over responsibilities
6. Use industry-specific keywords

Format the response as a single paragraph without any additional text or explanations.
`;

  try {
    // ✅ Updated Gemini API call
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const improvedContent = extractTextFromModelResponse(response) || "";

    if (!improvedContent) {
      console.error("improveWithAI: empty model response:", {
        sample: JSON.stringify(response).slice(0, 2000),
      });
      throw new Error("AI returned empty response");
    }

    return improvedContent;
  } catch (error) {
    console.error("Error improving content:", error);
    throw new Error("Failed to improve content");
  }
}
