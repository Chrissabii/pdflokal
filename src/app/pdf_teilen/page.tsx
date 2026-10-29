import type { Metadata } from "next";
import { SplitTool } from "@/components/pdfapp/tools/SplitTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF teilen",
};

export default function Page() {
  return (
    <ToolFrame>
      <SplitTool />
    </ToolFrame>
  );
}
