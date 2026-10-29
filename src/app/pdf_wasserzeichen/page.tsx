import type { Metadata } from "next";
import { WatermarkTool } from "@/components/pdfapp/tools/WatermarkTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "Wasserzeichen einfügen",
};

export default function Page() {
  return (
    <ToolFrame>
      <WatermarkTool />
    </ToolFrame>
  );
}
