// OCR for scanned pages with Tesseract (tesseract.js). Worker, WASM core and language data are served
// from public/tesseract, so recognition works offline.
import type { Worker as TesseractWorker } from "tesseract.js";
import { withBase } from "@/lib/base";

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
 */
export async function recognizeCanvas(worker: TesseractWorker, canvas: HTMLCanvasElement): Promise<OcrLine[]> {
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const blocks = (data as unknown as { blocks: TBlock[] | null }).blocks ?? [];
  const out: OcrLine[] = [];
  for (const block of blocks) {
    for (const p of block.paragraphs) {
      for (const l of p.lines) {
        const text = l.text.replace(/\s+/g, " ").trim();
        if (l.confidence >= 40 && /\p{L}{2}/u.test(text)) out.push({ ...l.bbox, text, confidence: l.confidence });
      }
    }
  }
  return out;
}
