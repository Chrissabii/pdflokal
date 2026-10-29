// Extracts positioned text blocks (paragraph-like groups of lines) from a PDF with pdf.js,
// falling back to Tesseract OCR for scanned pages.
// Coordinates are PDF user space (origin bottom-left), the same space pdf-lib draws in.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Worker as TesseractWorker } from "tesseract.js";
import { createOcr, recognizeCanvas } from "./ocr";
import { buildBlocks, buildLines, groupText, isHorizontal, type Line, type Run } from "./layout";

export interface TextBlock {
  /** bounding box in user space */
  x: number;
  y: number; // bottom
  width: number;
  height: number;
  fontSize: number;
  text: string;
  lineCount: number;
  /** sampled from the rendered page, 0..1 */
  color: [number, number, number];
  background: [number, number, number];
}

export interface PageText {
  index: number;
  blocks: TextBlock[];
  /** text runs that could not be placed (rotated/vertical text) — kept untouched */
  skipped: number;
  /** true if the blocks come from OCR (scanned page) */
  ocr: boolean;
}

export type OcrMode = "auto" | "always" | "off";

export interface ExtractOptions {
  ocr: OcrMode;
  /** Tesseract language codes, e.g. ["deu", "eng"] */
  ocrLangs: string[];
  onPage?: (done: number) => void;
  /** OCR progress of the current page, 0..1 */
  onOcr?: (pageIndex: number, progress: number) => void;
}

/** Pages with fewer selectable characters than this count as scanned in "auto" mode. */
const SCANNED_THRESHOLD = 20;


type Rgb = [number, number, number];

function sampleColors(
  ctx: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
): { color: Rgb; background: Rgb } {
  const left = Math.max(0, Math.floor(box.left));
  const top = Math.max(0, Math.floor(box.top));
  const w = Math.max(1, Math.min(ctx.canvas.width - left, Math.ceil(box.width)));
  const h = Math.max(1, Math.min(ctx.canvas.height - top, Math.ceil(box.height)));
  const data = ctx.getImageData(left, top, w, h).data;
  // background = most frequent (quantized) color; text = the darkest-contrast pixel group vs background
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = counts.get(key);
    if (c) {
      c.n++;
      c.r += data[i];
      c.g += data[i + 1];
      c.b += data[i + 2];
    } else counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  const buckets = [...counts.values()].sort((a, b) => b.n - a.n);
  const avg = (c: { n: number; r: number; g: number; b: number }): Rgb => [c.r / c.n / 255, c.g / c.n / 255, c.b / c.n / 255];
  const background = avg(buckets[0]);
  const lum = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const bgLum = lum(background);
  let best: Rgb = bgLum > 0.5 ? [0, 0, 0] : [1, 1, 1];
  let bestScore = 0;
  for (const b of buckets.slice(1, 40)) {
    const c = avg(b);
    const contrast = Math.abs(lum(c) - bgLum);
    const score = contrast * Math.log(1 + b.n);
    if (contrast > 0.25 && score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { color: best, background };
}

type PdfPage = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
type TextContent = Awaited<ReturnType<PdfPage["getTextContent"]>>;

/** All Tesseract languages bundled in public/tesseract/lang. */
export const BUNDLED_OCR = ["deu", "eng", "ita", "fra", "spa", "nld"];

/**
 * Extracts text blocks of the given 0-based pages.
 * OCR in "auto" mode runs only when the document as a whole is scanned (most pages without a text
 * layer) — photo pages or near-empty pages of a normal digital PDF are left alone.
 * With ocrLangs "auto", the first scanned page is read with all bundled languages, its language is
 * detected and the remaining pages use just that language (faster, more accurate).
 */
export async function extractPages(
  doc: PDFDocumentProxy,
  pageIndices: number[],
  options: Omit<ExtractOptions, "ocrLangs"> & { ocrLangs: string[] | "auto"; detect?: (text: string) => string | undefined } = {
    ocr: "auto",
    ocrLangs: "auto",
  },
): Promise<PageText[]> {
  const result: PageText[] = [];
  let ocrWorker: TesseractWorker | null = null;
  let ocrLangs: string[] | null = options.ocrLangs === "auto" ? null : options.ocrLangs;
  let ocrPageIndex = 0;

  // first pass: how much selectable text does each page have?
  const contents = new Map<number, TextContent>();
  let lowText = 0;
  for (const index of pageIndices) {
    const page = await doc.getPage(index + 1);
    const content = await page.getTextContent();
    contents.set(index, content);
    if (content.items.reduce((n, it) => n + ("str" in it ? it.str.trim().length : 0), 0) < SCANNED_THRESHOLD) lowText++;
  }
  const scannedDocument = pageIndices.length > 0 && lowText / pageIndices.length >= 0.6;

  try {
    for (const index of pageIndices) {
      const page = await doc.getPage(index + 1);
      const content = contents.get(index)!;
      const textChars = content.items.reduce((n, it) => n + ("str" in it ? it.str.trim().length : 0), 0);
      const useOcr = options.ocr === "always" || (options.ocr === "auto" && scannedDocument && textChars < SCANNED_THRESHOLD);
      if (useOcr) {
        ocrPageIndex = index;
        const onProgress = (p: number) => options.onOcr?.(ocrPageIndex, p);
        ocrWorker ??= await createOcr(ocrLangs ?? BUNDLED_OCR, onProgress);
        const text = await ocrPage(page, index, ocrWorker);
        result.push(text);
        if (!ocrLangs) {
          // language of the scan is now known → continue with only that language if bundled
          const detected = options.detect?.(text.blocks.map((b) => b.text).join(" "));
          ocrLangs = detected && BUNDLED_OCR.includes(detected) ? [detected] : BUNDLED_OCR;
          if (ocrLangs.length === 1) {
            await ocrWorker.terminate();
            ocrWorker = await createOcr(ocrLangs, onProgress);
          }
        }
      } else {
        result.push(await textPage(page, index, content));
      }
      page.cleanup();
      contents.delete(index);
      options.onPage?.(result.length);
    }
  } finally {
    await ocrWorker?.terminate();
  }
  return result;
}

/** Renders the page without /Rotate, so canvas axes map directly onto user space. */
async function renderUnrotated(page: PdfPage, scale: number) {
  // rotation replaces the page's /Rotate in pdf.js, so 0 gives the unrotated view.
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas wird nicht unterstützt");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
  return { viewport, canvas, ctx };
}

/** Page with selectable text: group pdf.js text runs into blocks, sample colors from a render. */
async function textPage(page: PdfPage, index: number, content: TextContent): Promise<PageText> {
  const runs: Run[] = [];
  let skipped = 0;
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    if (!isHorizontal(item.transform)) {
      if (item.str.trim()) skipped++;
      continue;
    }
    const size = item.transform[3];
    runs.push({ x: item.transform[4], y: item.transform[5], right: item.transform[4] + item.width, size, str: item.str });
  }
  const groups = buildBlocks(buildLines(runs));
  const { viewport, canvas, ctx } = await renderUnrotated(page, 1.5);

  const blocks: TextBlock[] = groups.map((g) => {
    const first = g.lines[0];
    const last = g.lines[g.lines.length - 1];
    const top = first.y + first.size * 0.95;
    const bottom = last.y - last.size * 0.28;
    const box = { x: g.x, y: bottom, width: g.right - g.x, height: top - bottom };
    const [x1, y1] = viewport.convertToViewportPoint(box.x, top);
    const [x2, y2] = viewport.convertToViewportPoint(box.x + box.width, bottom);
    const colors = sampleColors(ctx, {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
    return { ...box, fontSize: g.size, text: groupText(g.lines), lineCount: g.lines.length, ...colors };
  });
  canvas.width = canvas.height = 0;
  return { index, blocks: blocks.filter((b) => /[\p{L}]/u.test(b.text)), skipped, ocr: false };
}

/** Scanned page: render at ~216 dpi, OCR it, and group the recognized lines into blocks. */
async function ocrPage(page: PdfPage, index: number, worker: TesseractWorker): Promise<PageText> {
  const scale = 3;
  const { viewport, canvas, ctx } = await renderUnrotated(page, scale);
  const ocrLines = await recognizeCanvas(worker, canvas);
  const lines: Line[] = ocrLines.map((l) => {
    const [ux0, uy0] = viewport.convertToPdfPoint(l.x0, l.y1); // bottom-left
    const [ux1, uy1] = viewport.convertToPdfPoint(l.x1, l.y0); // top-right
    const bottom = Math.min(uy0, uy1);
    // a recognized line box (ascender to descender) is roughly 1.2 × the font size
    const size = Math.abs(uy1 - uy0) / 1.2;
    return {
      x: Math.min(ux0, ux1),
      right: Math.max(ux0, ux1),
      y: bottom + size * 0.22, // approximate baseline
      size,
      runs: [],
      text: l.text,
    };
  });
  lines.sort((a, b) => b.y - a.y || a.x - b.x);
  const blocks: TextBlock[] = buildBlocks(lines).map((g) => {
    const first = g.lines[0];
    const last = g.lines[g.lines.length - 1];
    const top = first.y + first.size * 0.95;
    const bottom = last.y - last.size * 0.28;
    const box = { x: g.x, y: bottom, width: g.right - g.x, height: top - bottom };
    const [x1, y1] = viewport.convertToViewportPoint(box.x, top);
    const [x2, y2] = viewport.convertToViewportPoint(box.x + box.width, bottom);
    const colors = sampleColors(ctx, {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
    // OCR sizes vary a little from line to line; use the block's median
    const sizes = g.lines.map((l) => l.size).sort((a, b) => a - b);
    return {
      ...box,
      fontSize: sizes[Math.floor(sizes.length / 2)],
      text: groupText(g.lines),
      lineCount: g.lines.length,
      ...colors,
    };
  });
  canvas.width = canvas.height = 0;
  return { index, blocks, skipped: 0, ocr: true };
}
