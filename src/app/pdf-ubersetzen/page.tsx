import type { Metadata } from "next";
import { TranslateTool } from "@/components/pdfapp/tools/TranslateTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF übersetzen",
};

export default function Page() {
  return (
    <ToolFrame>
      <TranslateTool />
    </ToolFrame>
  );
}
