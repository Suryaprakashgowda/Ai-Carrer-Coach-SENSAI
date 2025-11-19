import { db } from "@/lib/prisma";
import { inngest } from "./client";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const generateIndustryInsights = inngest.createFunction(
  { name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" }, // Run every Sunday at midnight
  async ({ event, step }) => {
    // Fetch distinct industries from users (include any new industries that may not yet have insights)
    const industries = await step.run("Fetch industries from users", async () => {
      const rows = await db.user.findMany({ select: { industry: true } });
      const set = new Set();
      rows.forEach((r) => r.industry && set.add(r.industry));
      return Array.from(set).map((i) => ({ industry: i }));
    });

    for (const { industry } of industries) {
      if (!industry) continue;

      const prompt = `Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:\n{\n  "salaryRanges": [\n    { "role": "string", "min": number, "max": number, "median": number, "location": "string" }\n  ],\n  "growthRate": number,\n  "demandLevel": "High" | "Medium" | "Low",\n  "topSkills": ["skill1", "skill2"],\n  "marketOutlook": "Positive" | "Neutral" | "Negative",\n  "keyTrends": ["trend1", "trend2"],\n  "recommendedSkills": ["skill1", "skill2"]\n}\n\nIMPORTANT: Return ONLY the JSON. No additional text, notes, or markdown formatting. Include at least 5 common roles for salary ranges. Growth rate should be a percentage. Include at least 5 skills and trends.`;

      const res = await step.ai.wrap(
        "gemini",
        async (p) => {
          return await model.generateContent(p);
        },
        prompt
      );

      const text =
        res?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
        res?.response?.candidates?.[0]?.content?.text ||
        "";
      const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

      let insights = {};
      try {
        insights = JSON.parse(cleanedText);
      } catch (e) {
        console.error(`Failed to parse insights JSON for ${industry}:`, e, cleanedText.slice(0, 1000));
        continue; // skip this industry to avoid corrupting DB
      }

      await step.run(`Upsert ${industry} insights`, async () => {
        await db.industryInsight.upsert({
          where: { industry },
          update: {
            ...insights,
            lastUpdated: new Date(),
            nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          create: {
            industry,
            ...insights,
            lastUpdated: new Date(),
            nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      });
    }
  }
);
