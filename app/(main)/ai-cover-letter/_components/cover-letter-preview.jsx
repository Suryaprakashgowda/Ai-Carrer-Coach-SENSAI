"use client";

import React, { useRef, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

const CoverLetterPreview = ({ content }) => {
  const containerRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadMarkdown = () => {
    try {
      const blob = new Blob([content || ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cover-letter.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Markdown downloaded");
    } catch (e) {
      console.error("Failed to download markdown", e);
      toast.error("Failed to download markdown");
    }
  };

  const downloadPDF = async () => {
    setIsGenerating(true);
    try {
      // wait for fonts
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
        await new Promise((r) => setTimeout(r, 120));
      }

      const html2pdfModule = await import("html2pdf.js/dist/html2pdf.min.js");
      const html2pdf = html2pdfModule.default || html2pdfModule;

      // Prefer the visible preview node
      const el = containerRef.current || document.body;

      const opt = {
        margin: [10, 10],
        filename: "cover-letter.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      };

      await html2pdf().set(opt).from(el).save();
      toast.success("PDF downloaded");
    } catch (e) {
      console.error("PDF generation failed", e);
      toast.error("Failed to generate PDF");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="py-4">
      <div className="flex items-center justify-end mb-3 gap-2">
        <Button variant="outline" size="sm" onClick={downloadMarkdown}>
          <Download className="h-4 w-4 mr-2" />
          Download .md
        </Button>
        <Button onClick={downloadPDF} disabled={isGenerating}>
          {isGenerating ? "Generating..." : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </>
          )}
        </Button>
      </div>

      <div ref={containerRef}>
        <MDEditor value={content} preview="preview" height={700} />
      </div>
    </div>
  );
};

export default CoverLetterPreview;
