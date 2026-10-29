import type { Metadata } from "next";
import { PageNumbersTool } from "@/components/pdfapp/tools/PageNumbersTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "Seitenzahlen einfügen",
};

export default function Page() {
  return (
    <ToolFrame>
      <PageNumbersTool />
    </ToolFrame>
  );
}
