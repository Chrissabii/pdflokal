// Extracts positioned text blocks (paragraph-like groups of lines) from a PDF with pdf.js,
// falling back to Tesseract OCR for scanned pages.
// Coordinates are PDF user space (origin bottom-left), the same space pdf-lib draws in.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Worker as TesseractWorker } from "tesseract.js";
import { createOcr, recognizeCanvas, type OcrFilter, type OcrLine } from "./ocr";
import { buildBlocks, buildLines, groupText, isHorizontal, mergeRects, type Line, type Rect, type Run } from "./layout";

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
  /** true if the text was recognized in an image (it can only be covered, not removed) */
  ocr?: boolean;
  /** share of the box covered by its most common color (1 = flat background, low = photo) */
  backgroundShare?: number;
  /** alignment of the lines in the original */
  align?: "left" | "center" | "right";
  /** widest line of the original and its width (pt), to match the replacement font's width */
  widest?: { text: string; width: number };
  /** style of the original font (digital text only) */
  bold?: boolean;
  serif?: boolean;
}

export interface PageText {
  index: number;
  blocks: TextBlock[];
  /** text runs that could not be placed (rotated/vertical text) — kept untouched */
  skipped: number;
  /** true if the blocks come from OCR (scanned page) */
  ocr: boolean;
  /** areas covered by images (user space): translated text must not grow into them */
  images?: Rect[];
}

export type OcrMode = "auto" | "always" | "off";

export interface ExtractOptions {
  ocr: OcrMode;
  /** Tesseract language codes, e.g. ["deu", "eng"] */
  ocrLangs: string[];
  onPage?: (done: number) => void;
  /** OCR progress of the current page, 0..1 */
  onOcr?: (pageIndex: number, progress: number) => void;
  /** text sampled across the whole document (for language detection) */
  onSampleText?: (text: string) => void;
}

/** Pages with fewer selectable characters than this count as scanned in "auto" mode. */
const SCANNED_THRESHOLD = 20;
/** Images smaller than this (pt) are not searched for text (icons, bullets, logos). */
const MIN_IMAGE = { width: 60, height: 24 };
/** Render scale for OCR (~216 dpi). */
const OCR_SCALE = 3;


type Rgb = [number, number, number];

function sampleColors(
  ctx: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
): { color: Rgb; background: Rgb; backgroundShare: number } {
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
  return { color: best, background, backgroundShare: buckets[0].n / (w * h) };
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

  // first pass: how much selectable text does each page have? Besides the selected pages, a spread of
  // the whole document is sampled, so translating just a photo cover doesn't count as a "scan".
  const contents = new Map<number, TextContent>();
  const spread = Array.from({ length: Math.min(12, doc.numPages) }, (_, i) => Math.floor((i * doc.numPages) / Math.min(12, doc.numPages)));
  const sampled = [...new Set([...pageIndices, ...spread])];
  let lowText = 0;
  let sampleText = "";
  for (const index of sampled) {
    const page = await doc.getPage(index + 1);
    const content = await page.getTextContent();
    if (pageIndices.includes(index)) contents.set(index, content);
    const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    if (text.replace(/\s/g, "").length < SCANNED_THRESHOLD) lowText++;
    if (sampleText.length < 5000) sampleText += ` ${text}`;
  }
  const scannedDocument = sampled.length > 0 && lowText / sampled.length >= 0.6;
  // a few words on a cover are too little to tell the language; the caller can use this sample too
  options.onSampleText?.(sampleText.slice(0, 5000));
  if (!ocrLangs && !scannedDocument) {
    // digital document: the language for text inside images is the language of the text layer
    const detected = options.detect?.(sampleText.slice(0, 5000));
    ocrLangs = detected && BUNDLED_OCR.includes(detected) ? [detected] : BUNDLED_OCR;
  }
  // text inside photos/graphics of digital pages is read with OCR unless OCR is switched off
  const imageOcr =
    options.ocr === "off"
      ? undefined
      : async () => (ocrWorker ??= await createOcr(ocrLangs ?? BUNDLED_OCR, (p) => options.onOcr?.(ocrPageIndex, p)));

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
        ocrPageIndex = index;
        result.push(await textPage(page, index, content, imageOcr));
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


type Viewport = ReturnType<PdfPage["getViewport"]>;
type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Bounding boxes (user space) of the raster images painted on the page, clipped to the page. */
async function imageRects(page: PdfPage): Promise<Rect[]> {
  const { OPS } = await import("pdfjs-dist");
  const list = await page.getOperatorList({ intent: "print" });
  const [px0, py0, px1, py1] = page.view;
  const rects: Rect[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      // an image fills the unit square of the current transform
      const xs = [0, 1, 0, 1].map((u, k) => ctm[0] * u + ctm[2] * [0, 0, 1, 1][k] + ctm[4]);
      const ys = [0, 1, 0, 1].map((u, k) => ctm[1] * u + ctm[3] * [0, 0, 1, 1][k] + ctm[5]);
      const x = Math.max(px0, Math.min(...xs));
      const y = Math.max(py0, Math.min(...ys));
      const width = Math.min(px1, Math.max(...xs)) - x;
      const height = Math.min(py1, Math.max(...ys)) - y;
      if (width > 1 && height > 1) rects.push({ x, y, width, height });
    }
  });
  return mergeRects(rects).filter((r) => r.width >= MIN_IMAGE.width && r.height >= MIN_IMAGE.height);
}

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

interface FontStyle {
  bold: boolean;
  serif: boolean;
}

const BOLD = /bold|black|heavy|semibold|demi/i;
const SANS = /sans|grotesk|gothic|arial|helvetica|verdana|lato|roboto|open|montserrat|inter|calibri|segoe|futura|avenir/i;
const SERIF = /serif|times|georgia|garamond|roman|minion|playfair|baskerville|bodoni|cambria|caslon|palatino|didot|book/i;

/**
 * Draws a letter with feet ("I", "l", "n" …) in the PDF's own font, which pdf.js has loaded for
 * rendering, and checks whether the bottom of the stroke is clearly wider than its middle (serifs).
 */
function hasSerifs(fontFace: string, sample: string) {
  const letter = [..."Ilihnmr"].find((ch) => sample.includes(ch));
  if (!letter || !document.fonts.check(`100px "${fontFace}"`)) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 140;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.font = `100px "${fontFace}"`;
  g.fillText(letter, 30, 110);
  const m = g.measureText(letter);
  const inked = (y: number) => {
    const d = g.getImageData(0, y, canvas.width, 1).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  };
  const stem = inked(Math.round(110 - (m.actualBoundingBoxAscent || 70) * 0.45));
  const foot = inked(107);
  return stem > 0 ? foot > stem * 1.5 : undefined;
}

/**
 * Bold/serif of the page's fonts, from the embedded font name ("ABCDEF+Lato-Bold") once the page has
 * been rendered; fonts with unknown names are checked visually, else pdf.js' generic family is used.
 */
function fontStyles(page: PdfPage, content: TextContent) {
  const cache = new Map<string, FontStyle>();
  return (id: string): FontStyle => {
    let s = cache.get(id);
    if (!s) {
      let font: { name?: string; loadedName?: string } | undefined;
      try {
        font = page.commonObjs.get(id) as typeof font;
      } catch {
        // font not resolved
      }
      const name = font?.name ?? "";
      const known = SANS.test(name) ? false : SERIF.test(name) ? true : undefined;
      const sample = content.items.map((it) => ("str" in it && it.fontName === id ? it.str : "")).join("");
      const serif = known ?? (font?.loadedName ? hasSerifs(font.loadedName, sample) : undefined) ?? content.styles[id]?.fontFamily === "serif";
      s = { bold: BOLD.test(name), serif };
      cache.set(id, s);
    }
    return s;
  };
}

/** Converts OCR lines (pixels of a canvas rendered with `viewport`) into text blocks. */
function ocrBlocks(ocrLines: OcrLine[], viewport: Viewport, ctx: CanvasRenderingContext2D): TextBlock[] {
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
  return buildBlocks(lines).map((g) => {
    // OCR sizes vary a little from line to line; use the block's median
    const sizes = g.lines.map((l) => l.size).sort((a, b) => a - b);
    return { ...toBlock(g, sizes[Math.floor(sizes.length / 2)], viewport, ctx), ocr: true };
  });
}

function toBlock(g: ReturnType<typeof buildBlocks>[number], fontSize: number, viewport: Viewport, ctx: CanvasRenderingContext2D): TextBlock {
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
  const view = viewport.viewBox as number[];
  const align = alignment(g.lines, g.x, g.right, view[0], view[2]);
  const widestLine = g.lines.reduce((a, l) => (l.right - l.x > a.right - a.x ? l : a), g.lines[0]);
  return {
    ...box,
    fontSize,
    // centered headings keep their line breaks
    text: align === "center" && g.lines.length > 1 ? g.lines.map((l) => l.text.trim()).join("\n") : groupText(g.lines),
    lineCount: g.lines.length,
    ...colors,
    align,
    widest: { text: widestLine.text.trim(), width: widestLine.right - widestLine.x },
  };
}

/** Left, centered or right aligned: from the lines of a block, or for one line from its position on the page. */
function alignment(lines: Line[], x: number, right: number, pageLeft: number, pageRight: number): "left" | "center" | "right" {
  const tol = Math.max(3, lines[0].size * 0.5);
  const mid = (x + right) / 2;
  if (lines.length > 1) {
    const left = lines.every((l) => Math.abs(l.x - x) < tol);
    if (!left && lines.every((l) => Math.abs((l.x + l.right) / 2 - mid) < tol)) return "center";
    if (!left && lines.every((l) => Math.abs(l.right - right) < tol)) return "right";
    return "left";
  }
  const width = pageRight - pageLeft;
  return Math.abs(mid - (pageLeft + pageRight) / 2) < width * 0.02 && x - pageLeft > width * 0.12 ? "center" : "left";
}

/**
 * Page with selectable text: group pdf.js text runs into blocks, sample colors from a render.
 * With `ocr`, text inside the page's images (photos with captions, scanned figures …) is recognized
 * too and added as extra blocks, skipping anything already covered by the text layer.
 */
async function textPage(page: PdfPage, index: number, content: TextContent, ocr?: () => Promise<TesseractWorker>): Promise<PageText> {
  const runs: Run[] = [];
  let skipped = 0;
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    if (!isHorizontal(item.transform)) {
      if (item.str.trim()) skipped++;
      continue;
    }
    const size = item.transform[3];
    runs.push({ x: item.transform[4], y: item.transform[5], right: item.transform[4] + item.width, size, str: item.str, font: item.fontName });
  }
  const images = await imageRects(page);
  const { viewport, canvas, ctx } = await renderUnrotated(page, ocr && images.length ? OCR_SCALE : 1.5);
  const style = fontStyles(page, content);
  // a one-line heading centered on the banner/image behind it is centered, even off the page middle
  const centerOnImage = (b: TextBlock): TextBlock => {
    if (b.align !== "left" || b.lineCount !== 1) return b;
    const mid = b.x + b.width / 2;
    const img = images.find((r) => overlap(r, b) > 0.8 * b.width * b.height);
    return img && Math.abs(mid - (img.x + img.width / 2)) < img.width * 0.03 && b.x - img.x > img.width * 0.1 ? { ...b, align: "center" } : b;
  };
  const blocks: TextBlock[] = buildBlocks(buildLines(runs)).map((g) => {
    // the style most of the block's characters are set in
    const runsOf = g.lines.flatMap((l) => l.runs);
    const total = runsOf.reduce((n, r) => n + r.str.length, 0) || 1;
    const share = (pick: keyof FontStyle) => runsOf.reduce((n, r) => n + (r.font && style(r.font)[pick] ? r.str.length : 0), 0) / total;
    return centerOnImage({ ...toBlock(g, g.size, viewport, ctx), bold: share("bold") > 0.5, serif: share("serif") > 0.5 });
  });

  if (ocr && images.length) {
    const worker = await ocr();
    for (const img of images) {
      const [ax, ay] = viewport.convertToViewportPoint(img.x, img.y + img.height);
      const [bx, by] = viewport.convertToViewportPoint(img.x + img.width, img.y);
      const left = Math.max(0, Math.floor(Math.min(ax, bx)));
      const top = Math.max(0, Math.floor(Math.min(ay, by)));
      const region = { left, top, width: Math.min(canvas.width - left, Math.ceil(Math.abs(bx - ax))), height: Math.min(canvas.height - top, Math.ceil(Math.abs(by - ay))) };
      // lines that are already in the text layer (text printed over a background image) are dropped
      // line by line: a paragraph-level check misses OCR blocks that span several text paragraphs
      const found = (await recognizeRegion(worker, canvas, region, "strict")).filter((l) => {
        const [x0, y0] = viewport.convertToPdfPoint(l.x0, l.y1);
        const [x1, y1] = viewport.convertToPdfPoint(l.x1, l.y0);
        const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
        return blocks.reduce((sum, v) => sum + overlap(v, r), 0) < 0.3 * r.width * r.height;
      });
      for (const b of ocrBlocks(found, viewport, ctx)) {
        // text drawn on top of the image is already in the text layer
        // On photos a replaced patch looks worse than the original text: only flat backgrounds
        if (!blocks.some((v) => overlap(v, b) > 0.3 * b.width * b.height) && (b.backgroundShare ?? 1) >= 0.5) blocks.push(b);
      }
    }
  }
  canvas.width = canvas.height = 0;
  return { index, blocks: blocks.filter((b) => /[\p{L}]/u.test(b.text)), skipped, ocr: false, images };
}

/**
 * OCR of a canvas region in three sizes: Tesseract reads big headlines best at ~72 dpi and small print
 * at full resolution. Lines found in a coarser pass win where passes overlap.
 * Returned coordinates are pixels of the full canvas.
 */
async function recognizeRegion(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  region: { left: number; top: number; width: number; height: number },
  filter: OcrFilter,
): Promise<OcrLine[]> {
  const { left, top, width, height } = region;
  const found: OcrLine[] = [];
  if (width < 8 || height < 8) return found;
  const box = (l: OcrLine) => ({ x: l.x0, y: l.y0, width: l.x1 - l.x0, height: l.y1 - l.y0 });
  for (const factor of [1 / OCR_SCALE, 2 / OCR_SCALE, 1]) {
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(width * factor));
    crop.height = Math.max(1, Math.round(height * factor));
    const cropCtx = crop.getContext("2d")!;
    cropCtx.imageSmoothingQuality = "high";
    cropCtx.drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
    const lines = (await recognizeCanvas(worker, crop, filter)).map((l) => ({
      ...l,
      x0: l.x0 / factor + left,
      x1: l.x1 / factor + left,
      y0: l.y0 / factor + top,
      y1: l.y1 / factor + top,
    }));
    crop.width = crop.height = 0;
    found.push(...lines.filter((l) => !found.some((f) => overlap(box(f), box(l)) > 0.3 * box(l).width * box(l).height)));
  }
  return found;
}

/** Scanned page: render at ~216 dpi, OCR it, and group the recognized lines into blocks. */
async function ocrPage(page: PdfPage, index: number, worker: TesseractWorker): Promise<PageText> {
  const { viewport, canvas, ctx } = await renderUnrotated(page, OCR_SCALE);
  const lines = await recognizeRegion(worker, canvas, { left: 0, top: 0, width: canvas.width, height: canvas.height }, "scan");
  const blocks = ocrBlocks(lines, viewport, ctx);
  canvas.width = canvas.height = 0;
  return { index, blocks, skipped: 0, ocr: true };
}
