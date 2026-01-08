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
      // Prefer the visible preview node; if needed clone into off-screen visible node
      const source = containerRef.current || document.body;

      const ensureClone = async (elToClone) => {
        const clone = elToClone.cloneNode(true);
        clone.style.position = "absolute";
        clone.style.top = "-9999px";
        clone.style.left = "-9999px";
        // Set content width to A4 minus left/right margins (A4 = 210mm, margins 10mm each => 190mm)
        // Convert 190mm to px at ~96dpi: px = mm * 96 / 25.4
        clone.style.width = Math.round((190 * 96) / 25.4) + "px";
        clone.style.background = "white";
        clone.style.color = "black";
        clone.id = "cover-letter-pdf-clone";
        document.body.appendChild(clone);
        // allow layout to settle
        await new Promise((r) => setTimeout(r, 80));
        return clone;
      };

      const el = await ensureClone(source);

      const opt = {
        // margins in mm (jsPDF unit = mm): top, left, bottom, right
        margin: [7.5, 10, 7.5, 10],
        filename: "cover-letter.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      };

      await html2pdf().set(opt).from(el).save();

      const cloneEl = document.getElementById("cover-letter-pdf-clone");
      if (cloneEl) cloneEl.remove();
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
