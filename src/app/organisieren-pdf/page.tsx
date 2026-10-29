import type { Metadata } from "next";
import { OrganizeTool } from "@/components/pdfapp/tools/OrganizeTool";
import { ToolFrame } from "@/components/pdfapp/tools/ToolFrame";

export const metadata: Metadata = {
  title: "PDF organisieren",
};

export default function Page() {
  return (
    <ToolFrame>
      <OrganizeTool />
    </ToolFrame>
  );
}
