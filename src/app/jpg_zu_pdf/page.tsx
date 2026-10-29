import type { Metadata } from "next";
import { JpgToPdfTool } from "@/components/pdfapp/tools/JpgToPdfTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "Bilder in PDF umwandeln",
};

export default function Page() {
  return (
    <ToolFrame>
      <JpgToPdfTool />
    </ToolFrame>
  );
}
