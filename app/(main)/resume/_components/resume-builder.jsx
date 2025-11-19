"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Download,
  Edit,
  Loader2,
  Monitor,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import MDEditor from "@uiw/react-md-editor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { saveResume, improveWithAI } from "@/actions/resume";
import { EntryForm } from "./entry-form";
import useFetch from "@/hooks/use-fetch";
import { useUser } from "@clerk/nextjs";
import { entriesToMarkdown } from "@/app/lib/helper";
import { resumeSchema } from "@/app/lib/schema";
// html2pdf depends on browser globals (window/self). Import it dynamically in the
// browser inside generatePDF() to avoid server-side evaluation errors.

export default function ResumeBuilder({ initialContent }) {
  const [activeTab, setActiveTab] = useState("edit");
  const [previewContent, setPreviewContent] = useState(initialContent);
  const { user } = useUser();
  const [resumeMode, setResumeMode] = useState("preview");

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resumeSchema),
    defaultValues: {
      contactInfo: {},
      summary: "",
      skills: "",
      experience: [],
      education: [],
      projects: [],
    },
  });

  const {
    loading: isImproving,
    fn: improveFn,
    data: improveResult,
    error: improveError,
  } = useFetch(improveWithAI);

  const [improveTarget, setImproveTarget] = useState(null);

  // Watch form fields for preview updates (declare early so effects can reference it)
  const formValues = watch();

  // Populate simple fields from initial markdown (summary, skills, contact)
  useEffect(() => {
    if (!initialContent) return;

    const md = initialContent;

    const extractSection = (title) => {
      const re = new RegExp(`##\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
      const m = md.match(re);
      return m ? m[1].trim() : "";
    };

    const summaryText = extractSection("Professional Summary");
    const skillsText = extractSection("Skills");

    if (summaryText) setValue("summary", summaryText);
    if (skillsText) setValue("skills", skillsText);

    // Basic contact extraction
    const emailMatch = md.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = md.match(/\+?[0-9][0-9()\-\s]{6,}/);
    const linkedinMatch = md.match(/https?:\/\/[^\s]*linkedin.com[^\s]*/i);
    const twitterMatch = md.match(/https?:\/\/[^\s]*twitter.com[^\s]*/i);

    setValue("contactInfo.email", emailMatch ? emailMatch[0] : "");
    setValue("contactInfo.mobile", phoneMatch ? phoneMatch[0] : "");
    setValue("contactInfo.linkedin", linkedinMatch ? linkedinMatch[0] : "");
    setValue("contactInfo.twitter", twitterMatch ? twitterMatch[0] : "");
  }, [initialContent, setValue]);

  // Apply AI improvement results back into the form AND update the markdown preview
  useEffect(() => {
    if (!improveResult || !improveTarget) return;
    try {
      // Update the form field
      setValue(improveTarget, improveResult);

      // Build an override object for preview generation
      let override = {};
      if (!improveTarget.includes(".")) {
        override[improveTarget] = improveResult;
      } else {
        // Handle nested paths like 'contactInfo.email'
        const parts = improveTarget.split(".");
        let cur = override;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (i === parts.length - 1) {
            cur[p] = improveResult;
          } else {
            cur[p] = cur[p] || {};
            cur = cur[p];
          }
        }
      }

      // Merge a shallow copy of formValues with the override for preview
      const merged = { ...(formValues || {}), ...override };
      if (override.contactInfo && formValues?.contactInfo) {
        merged.contactInfo = { ...formValues.contactInfo, ...override.contactInfo };
      }

      const newContent = getCombinedContent(merged);
      setPreviewContent(newContent || initialContent);

      toast.success("Improved with AI");
    } catch (e) {
      console.error("Failed to set AI result to form", e);
    } finally {
      setImproveTarget(null);
    }
  }, [improveResult, improveTarget, setValue, formValues, initialContent]);

  const {
    loading: isSaving,
    fn: saveResumeFn,
    data: saveResult,
    error: saveError,
  } = useFetch(saveResume);

  useEffect(() => {
    if (initialContent) setActiveTab("preview");
  }, [initialContent]);

  // Update preview content when form values change
  useEffect(() => {
    if (activeTab === "edit") {
      const newContent = getCombinedContent();
      setPreviewContent(newContent ? newContent : initialContent);
    }
  }, [formValues, activeTab]);

  // Handle save result
  useEffect(() => {
    if (saveResult && !isSaving) {
      toast.success("Resume saved successfully!");
    }
    if (saveError) {
      toast.error(saveError.message || "Failed to save resume");
    }
  }, [saveResult, saveError, isSaving]);

  const getContactMarkdown = (sourceValues) => {
    const { contactInfo } = sourceValues || formValues;
    const parts = [];
    if (contactInfo?.email) parts.push(`📧 ${contactInfo.email}`);
    if (contactInfo?.mobile) parts.push(`📱 ${contactInfo.mobile}`);
    if (contactInfo?.linkedin)
      parts.push(`💼 [LinkedIn](${contactInfo.linkedin})`);
    if (contactInfo?.twitter) parts.push(`🐦 [Twitter](${contactInfo.twitter})`);

    return parts.length > 0
      ? `## <div align="center">${user.fullName}</div>
        \n\n<div align="center">\n\n${parts.join(" | ")}\n\n</div>`
      : "";
  };

  const getCombinedContent = (overrideValues) => {
    const source = overrideValues || formValues;
    const { summary, skills, experience, education, projects } = source || {};
    return [
      getContactMarkdown(source),
      summary && `## Professional Summary\n\n${summary}`,
      skills && `## Skills\n\n${skills}`,
      entriesToMarkdown(experience, "Work Experience"),
      entriesToMarkdown(education, "Education"),
      entriesToMarkdown(projects, "Projects"),
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  // Parse markdown sections into structured form values including entries with current flag
  const parseMarkdownToForm = (md) => {
    if (!md) return null;

    const extractSection = (title) => {
      const re = new RegExp(`##\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
      const m = md.match(re);
      return m ? m[1].trim() : "";
    };

    const parseEntries = (sectionText) => {
      if (!sectionText) return [];
      const parts = sectionText.split(/^###\s+/m).map((p) => p.trim()).filter(Boolean);
      return parts.map((block) => {
        const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const firstLine = lines.shift() || "";

        // attempt to parse title and organization
        let title = firstLine;
        let organization = "";
        const sepMatch = firstLine.match(/\s@\s|\s-\s|\s\|\s|\s—\s/);
        if (sepMatch) {
          const parts = firstLine.split(sepMatch[0]);
          title = parts[0].trim();
          organization = parts[1] ? parts[1].trim() : "";
        }

        // parse dates from subsequent lines or parenthesis in first line
        let startDate = "";
        let endDate = "";
        const dateLine = lines.find((l) => /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(l)) || "";
        if (dateLine) {
          const dates = dateLine.match(/([A-Za-z]{3,9}\s\d{4}|\d{4}|\d{4}-\d{2})/g);
          if (dates && dates.length >= 1) {
            startDate = dates[0];
            if (dates.length >= 2) endDate = dates[1];
            else if (/present|current/i.test(dateLine)) endDate = "";
          }
        } else {
          const paren = firstLine.match(/\(([^)]+)\)/);
          if (paren) {
            const split = paren[1].split(/[-–—]/).map(s => s.trim());
            startDate = split[0] || "";
            endDate = split[1] || "";
          }
        }

        // determine current flag
        let current = false;
        if (!endDate || /present|current/i.test(endDate)) {
          current = true;
          endDate = "";
        }

        const description = lines.filter((l) => l !== dateLine).join("\n");

        return { title, organization, startDate, endDate, current, description };
      });
    };

    return {
      summary: extractSection("Professional Summary") || "",
      skills: extractSection("Skills") || "",
      contactInfo: {
        email: (md.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [""])[0],
        mobile: (md.match(/\+?[0-9][0-9()\-\s]{6,}/) || [""])[0],
        linkedin: (md.match(/https?:\/\/[^\s]*linkedin.com[^\s]*/i) || [""])[0],
        twitter: (md.match(/https?:\/\/[^\s]*twitter.com[^\s]*/i) || [""])[0],
      },
      experience: parseEntries(extractSection("Work Experience")),
      education: parseEntries(extractSection("Education")),
      projects: parseEntries(extractSection("Projects")),
    };
  };

  // Populate entry arrays when initialContent is provided so saved resumes display in the form
  useEffect(() => {
    if (!initialContent) return;
    try {
      const parsed = parseMarkdownToForm(initialContent);
      if (parsed) {
        setValue("experience", parsed.experience || []);
        setValue("education", parsed.education || []);
        setValue("projects", parsed.projects || []);
      }
    } catch (e) {
      console.error("Failed to parse entries from initialContent", e);
    }
  }, [initialContent, setValue]);

  const [isGenerating, setIsGenerating] = useState(false);

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      if (typeof window === "undefined") {
        throw new Error("PDF generation must run in the browser");
      }

      // dynamic import so the module is only loaded client-side
      const html2pdfModule = await import("html2pdf.js/dist/html2pdf.min.js");
      const html2pdf = html2pdfModule.default || html2pdfModule;

      const element = document.getElementById("resume-pdf");
      const opt = {
        margin: [15, 15],
        filename: "resume.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      };

      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error("PDF generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = async (data) => {
    try {
      const formattedContent = previewContent
        .replace(/\n/g, "\n") // Normalize newlines
        .replace(/\n\s*\n/g, "\n\n") // Normalize multiple newlines to double newlines
        .trim();

      console.log(previewContent, formattedContent);
      await saveResumeFn(previewContent);
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  return (
    <div data-color-mode="light" className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-center gap-2">
        <h1 className="font-bold gradient-title text-5xl md:text-6xl">
          Resume Builder
        </h1>
        <div className="space-x-2">
          <Button
            variant="destructive"
            onClick={handleSubmit(onSubmit)}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save
              </>
            )}
          </Button>
          <Button onClick={generatePDF} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="edit">Form</TabsTrigger>
          <TabsTrigger value="preview">Markdown</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/50">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    {...register("contactInfo.email")}
                    type="email"
                    placeholder="your@email.com"
                    error={errors.contactInfo?.email}
                  />
                  {errors.contactInfo?.email && (
                    <p className="text-sm text-red-500">
                      {errors.contactInfo.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mobile Number</label>
                  <Input
                    {...register("contactInfo.mobile")}
                    type="tel"
                    placeholder="+1 234 567 8900"
                  />
                  {errors.contactInfo?.mobile && (
                    <p className="text-sm text-red-500">
                      {errors.contactInfo.mobile.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">LinkedIn URL</label>
                  <Input
                    {...register("contactInfo.linkedin")}
                    type="url"
                    placeholder="https://linkedin.com/in/your-profile"
                  />
                  {errors.contactInfo?.linkedin && (
                    <p className="text-sm text-red-500">
                      {errors.contactInfo.linkedin.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Twitter/X Profile
                  </label>
                  <Input
                    {...register("contactInfo.twitter")}
                    type="url"
                    placeholder="https://twitter.com/your-handle"
                  />
                  {errors.contactInfo?.twitter && (
                    <p className="text-sm text-red-500">
                      {errors.contactInfo.twitter.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Professional Summary</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const current = watch("summary");
                    if (!current) return toast.error("No summary to improve");
                    setImproveTarget("summary");
                    improveFn({ current, type: "summary" });
                  }}
                >
                  {isImproving && improveTarget === "summary" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Improving...
                    </>
                  ) : (
                    "Improve with AI"
                  )}
                </Button>
              </div>
              <Controller
                name="summary"
                control={control}
                render={({ field }) => (
                  <Textarea
                    {...field}
                    className="h-32"
                    placeholder="Write a compelling professional summary..."
                    error={errors.summary}
                  />
                )}
              />
              {errors.summary && (
                <p className="text-sm text-red-500">{errors.summary.message}</p>
              )}
            </div>

            {/* Skills */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Skills</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const current = watch("skills");
                    if (!current) return toast.error("No skills to improve");
                    setImproveTarget("skills");
                    improveFn({ current, type: "skills" });
                  }}
                >
                  {isImproving && improveTarget === "skills" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Improving...
                    </>
                  ) : (
                    "Improve with AI"
                  )}
                </Button>
              </div>
              <Controller
                name="skills"
                control={control}
                render={({ field }) => (
                  <Textarea
                    {...field}
                    className="h-32"
                    placeholder="List your key skills..."
                    error={errors.skills}
                  />
                )}
              />
              {errors.skills && (
                <p className="text-sm text-red-500">{errors.skills.message}</p>
              )}
            </div>

            {/* Experience */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Work Experience</h3>
              <Controller
                name="experience"
                control={control}
                render={({ field }) => (
                  <EntryForm
                    type="Experience"
                    entries={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.experience && (
                <p className="text-sm text-red-500">
                  {errors.experience.message}
                </p>
              )}
            </div>

            {/* Education */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Education</h3>
              <Controller
                name="education"
                control={control}
                render={({ field }) => (
                  <EntryForm
                    type="Education"
                    entries={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.education && (
                <p className="text-sm text-red-500">
                  {errors.education.message}
                </p>
              )}
            </div>

            {/* Projects */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Projects</h3>
              <Controller
                name="projects"
                control={control}
                render={({ field }) => (
                  <EntryForm
                    type="Project"
                    entries={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.projects && (
                <p className="text-sm text-red-500">
                  {errors.projects.message}
                </p>
              )}
            </div>
          </form>
        </TabsContent>

        <TabsContent value="preview">
          {activeTab === "preview" && (
            <Button
              variant="link"
              type="button"
              className="mb-2"
              onClick={() =>
                setResumeMode(resumeMode === "preview" ? "edit" : "preview")
              }
            >
              {resumeMode === "preview" ? (
                <>
                  <Edit className="h-4 w-4" />
                  Edit Resume
                </>
              ) : (
                <>
                  <Monitor className="h-4 w-4" />
                  Show Preview
                </>
              )}
            </Button>
          )}

          {activeTab === "preview" && resumeMode !== "preview" && (
            <div className="flex p-3 gap-2 items-center border-2 border-yellow-600 text-yellow-600 rounded mb-2">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">
                You will lose editied markdown if you update the form data.
              </span>
            </div>
          )}
          <div className="border rounded-lg">
            <MDEditor
              value={previewContent}
              onChange={setPreviewContent}
              height={800}
              preview={resumeMode}
            />
          </div>
          <div className="hidden">
            <div id="resume-pdf">
              <MDEditor.Markdown
                source={previewContent}
                style={{
                  background: "white",
                  color: "black",
                }}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
