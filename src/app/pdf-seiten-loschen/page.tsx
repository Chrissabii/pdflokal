import type { Metadata } from "next";
import { RemovePagesTool } from "@/components/pdfapp/tools/RemovePagesTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF-Seiten entfernen",
};

export default function Page() {
  return (
    <ToolFrame>
      <RemovePagesTool />
    </ToolFrame>
  );
}
