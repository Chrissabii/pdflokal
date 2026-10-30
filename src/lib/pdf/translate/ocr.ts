// OCR for scanned pages with Tesseract (tesseract.js). Worker, WASM core and language data are served
// from public/tesseract, so recognition works offline.
import type { Worker as TesseractWorker } from "tesseract.js";
import { withBase } from "@/lib/base";
import { fixCase } from "./prepare";

export interface OcrLine {
  /** pixel bbox on the rendered canvas */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  confidence: number;
}

export async function createOcr(langs: string[], onProgress?: (p: number) => void): Promise<TesseractWorker> {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: withBase("/tesseract/worker.min.js"),
    corePath: withBase("/tesseract/core"),
    langPath: withBase("/tesseract/lang"),
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
}

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TLine {
  text: string;
  bbox: TBox;
  confidence: number;
  words: { text: string; confidence: number; bbox: TBox }[];
}

/**
 * Tesseract reads text that sits side by side (columns, boxes of an infographic) as one line. A line is
 * cut where the gap between two words is wider than its height, so each part is placed on its own.
 */
function splitAtGaps(l: TLine): TLine[] {
  const words = l.words.filter((w) => w.text.trim());
  if (words.length < 2) return [l];
  const gap = (l.bbox.y1 - l.bbox.y0) * 1.0;
  const parts: TLine["words"][] = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > gap) parts.push([]);
    parts[parts.length - 1].push(words[i]);
  }
  if (parts.length === 1) return [l];
  return parts.map((ws) => ({
    text: ws.map((w) => w.text).join(" "),
    confidence: ws.reduce((n, w) => n + w.confidence, 0) / ws.length,
    words: ws,
    bbox: {
      x0: Math.min(...ws.map((w) => w.bbox.x0)),
      y0: Math.min(...ws.map((w) => w.bbox.y0)),
      x1: Math.max(...ws.map((w) => w.bbox.x1)),
      y1: Math.max(...ws.map((w) => w.bbox.y1)),
    },
  }));
}

/**
 * Photos produce plenty of "text" from textures. A line is only trusted when it is confident overall,
 * mostly letters, and contains at least one real-looking word read with high confidence. Inside images
 * of digital PDFs ("strict") the bar is higher than on scanned pages ("scan").
 */
const FILTERS = {
  strict: { line: 65, word: 80, letters: 0.6 },
  scan: { line: 55, word: 70, letters: 0.5 },
};
export type OcrFilter = keyof typeof FILTERS;

function looksLikeText(l: TLine, filter: OcrFilter) {
  const f = FILTERS[filter];
  const text = l.text.replace(/\s+/g, "");
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return (
    l.confidence >= f.line &&
    letters >= text.length * f.letters &&
    l.words.some((w) => w.confidence >= f.word && (w.text.match(/\p{L}/gu) ?? []).length >= 3)
  );
}

interface TParagraph {
  text: string;
  bbox: TBox;
  confidence: number;
  lines: TLine[];
}
interface TBlock {
  paragraphs: TParagraph[];
}

/**
 * Returns recognized text lines. Lines (not Tesseract's paragraphs) are returned because Tesseract
 * often splits one paragraph mid-sentence; the caller groups lines with the same logic as for digital PDFs.
 * `filter` decides how sure Tesseract must be (see FILTERS).
 */
export async function recognizeCanvas(worker: TesseractWorker, canvas: HTMLCanvasElement, filter: OcrFilter): Promise<OcrLine[]> {
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const blocks = (data as unknown as { blocks: TBlock[] | null }).blocks ?? [];
  const out: OcrLine[] = [];
  for (const block of blocks) {
    for (const p of block.paragraphs) {
      for (const l of p.lines.flatMap(splitAtGaps)) {
        const text = l.text.replace(/\s+/g, " ").trim().split(" ").map(fixCase).join(" ");
        if (looksLikeText(l, filter)) out.push({ ...l.bbox, text, confidence: l.confidence });
      }
    }
  }
  return out;
}
