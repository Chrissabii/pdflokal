import type { Metadata } from "next";
import { RotateTool } from "@/components/pdfapp/tools/RotateTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF drehen",
};

export default function Page() {
  return (
    <ToolFrame>
      <RotateTool />
    </ToolFrame>
  );
}
