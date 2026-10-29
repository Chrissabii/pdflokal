// Client-only pdf.js helpers for page thumbnails. The worker is served from
// public/pdfjs (copied by scripts/copy-vendor-assets.mjs) so nothing loads from a CDN.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { withBase } from "@/lib/base";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = withBase("/pdfjs/pdf.worker.min.mjs");
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(bytes: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice(0), password }).promise;
}

/** Renders one page (0-based) to a PNG data URL whose longest side is `maxSize` px. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  maxSize = 180,
  rotation = 0,
): Promise<{ url: string; width: number; height: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const scale = (maxSize * (window.devicePixelRatio || 1)) / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird nicht unterstützt");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent renders without requestAnimationFrame, so thumbnails keep
  // rendering while the tab is in the background (display intent stalls there).
  await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
  page.cleanup();
  const ratio = base.width / base.height;
  // JPEG keeps thousands of thumbnails small in memory (white background, no transparency needed)
  const url = canvas.toDataURL("image/jpeg", 0.82);
  canvas.width = canvas.height = 0; // release the bitmap right away
  return {
    url,
    width: ratio >= 1 ? maxSize : Math.round(maxSize * ratio),
    height: ratio >= 1 ? Math.round(maxSize / ratio) : maxSize,
  };
}
