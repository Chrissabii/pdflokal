import type { MetadataRoute } from "next";
import { BRAND } from "@/components/pdfapp/brand";
import { withBase } from "@/lib/base";

// Required for metadata routes with `output: "export"`.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    lang: "de",
    start_url: withBase("/"),
    scope: withBase("/"),
    display: "standalone",
    background_color: "#f7f7fb",
    theme_color: "#4f46e5",
    icons: [
      { src: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBase("/icons/maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "PDF übersetzen", url: withBase("/pdf-ubersetzen/") },
      { name: "PDFs zusammenfügen", url: withBase("/pdf_zusammenfuegen/") },
      { name: "PDF teilen", url: withBase("/pdf_teilen/") },
    ],
  };
}
