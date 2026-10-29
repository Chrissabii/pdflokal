import type { Metadata } from "next";
import { MergeTool } from "@/components/pdfapp/tools/MergeTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDFs zusammenfügen",
};

export default function Page() {
  return (
    <ToolFrame>
      <MergeTool />
    </ToolFrame>
  );
}
