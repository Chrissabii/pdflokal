import type { Metadata } from "next";
import { CropTool } from "@/components/pdfapp/tools/CropTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF zuschneiden",
};

export default function Page() {
  return (
    <ToolFrame>
      <CropTool />
    </ToolFrame>
  );
}
