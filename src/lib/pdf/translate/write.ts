// Writes translated text back into a PDF with pdf-lib, using an embedded Unicode font (DejaVu Sans).
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import type { PageText, TextBlock } from "./extract";

export type TranslateOutputMode = "layout" | "text";

export interface FontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
  /** used for blocks whose original font was a serif font */
  serif?: ArrayBuffer;
  serifBold?: ArrayBuffer;
}

const MIN_SIZE = 4;

/**
 * Draws a text block as an image with the device's fonts — used for scripts the bundled font cannot
 * render (Arabic, Hebrew, CJK, Devanagari, Thai …). Provided by the browser (see raster.ts).
 */
export type RasterizeText = (o: {
  text: string;
  width: number; // pt
  height: number; // pt
  fontSize: number; // pt, starting size (shrunk to fit)
  color: [number, number, number];
  bold?: boolean;
}) => Promise<{ png: Uint8Array; height: number } | null>;

export interface WriteOptions {
  /** set when the target language needs the device's fonts */
  rasterize?: RasterizeText;
}

/** Greedy word wrap; words wider than the line are broken by characters. A newline starts a new line. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return text.split("\n").flatMap((para) => wrapParagraph(para, font, size, maxWidth));
}

function wrapParagraph(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (width(word) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (width(chunk + ch) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size (≤ start) at which `text` fits into the box, with its wrapped lines. */
export function fitText(text: string, font: PDFFont, start: number, width: number, height: number) {
  let size = Math.max(MIN_SIZE, start);
  for (;;) {
    const lineHeight = size * 1.18;
    const lines = wrapText(text, font, size, width);
    if (lines.length * lineHeight <= height + size * 0.2 || size <= MIN_SIZE) return { size, lineHeight, lines };
    size = Math.max(MIN_SIZE, size * 0.92);
  }
}

/** Removes characters the font cannot draw (pdf-lib would otherwise throw). */
function sanitize(text: string, font: PDFFont) {
  const set = new Set(font.getCharacterSet());
  return [...text.normalize("NFC")].map((ch) => (ch === "\n" || set.has(ch.codePointAt(0)!) ? ch : ch === "\t" ? " " : "")).join("");
}

export async function writeTranslatedPdf(
  original: ArrayBuffer,
  pages: PageText[],
  translations: string[][],
  mode: TranslateOutputMode,
  fonts: FontBytes,
  options: WriteOptions = {},
): Promise<Uint8Array> {
  if (mode === "text") return writeTextOnly(pages, translations, fonts, options);

  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  // fonts are embedded only when a block needs them
  const embedded = new Map<ArrayBuffer, Promise<PDFFont>>();
  const fontFor = (block: TextBlock) => {
    const sans = block.bold ? fonts.bold : fonts.regular;
    const bytes = block.serif ? ((block.bold ? fonts.serifBold : fonts.serif) ?? sans) : sans;
    if (!embedded.has(bytes)) embedded.set(bytes, doc.embedFont(bytes, { subset: true }));
    return embedded.get(bytes)!;
  };

  for (const [pi, p] of pages.entries()) {
    const page = doc.getPage(p.index);
    const bottomEdge = page.getCropBox().y + 12;

    // Pass 1: font size each block would need on its own. Blocks that had the same size in the
    // original then share one size (the median), so body paragraphs don't end up in random sizes.
    const roomFor = (block: TextBlock) => {
      const below = p.blocks
        .filter((o) => o !== block && o.y + o.height <= block.y + 0.5 && o.x < block.x + block.width && o.x + o.width > block.x)
        .reduce((top, o) => Math.max(top, o.y + o.height), bottomEdge);
      const room = Math.max(0, block.y - below - block.fontSize * 0.6);
      return block.height + Math.min(room, block.height * 1.5 + block.fontSize * 1.2);
    };
    const blockFonts = await Promise.all(p.blocks.map(fontFor));
    const fitted = p.blocks.map((block, bi) => {
      const font = blockFonts[bi];
      const text = sanitize(translations[pi]?.[bi] ?? block.text, font);
      const pad = Math.max(1, block.fontSize * 0.08);
      return options.rasterize || !text.trim() ? null : fitText(text, font, block.fontSize, block.width + pad, roomFor(block)).size;
    });
    const groupSize = new Map<number, number>();
    const groups = new Map<number, number[]>();
    p.blocks.forEach((b, i) => {
      if (fitted[i] === null) return;
      const key = Math.round(b.fontSize * 2) / 2;
      groups.set(key, [...(groups.get(key) ?? []), fitted[i]!]);
    });
    groups.forEach((sizes, key) => groupSize.set(key, median(sizes)));

    for (const [bi, block] of p.blocks.entries()) {
      const raw = translations[pi]?.[bi] ?? block.text;
      const font = blockFonts[bi];
      const text = options.rasterize ? raw : sanitize(raw, font);
      if (!text.trim()) continue;
      const pad = Math.max(1, block.fontSize * 0.08);
      const [br, bg, bb] = block.background;
      page.drawRectangle({
        x: block.x - pad,
        y: block.y - pad,
        width: block.width + pad * 2,
        height: block.height + pad * 2,
        color: rgb(br, bg, bb),
      });
      // Translations often run longer than the source: let the text grow downwards into free space
      // (up to the next block that shares its column) before shrinking the font.
      const height = roomFor(block);
      if (options.rasterize) {
        const img = await options.rasterize({ text, width: block.width + pad, height, fontSize: block.fontSize, color: block.color, bold: block.bold });
        if (img) {
          const png = await doc.embedPng(img.png);
          page.drawImage(png, { x: block.x, y: block.y + block.height - img.height, width: block.width + pad, height: img.height });
        }
        continue;
      }
      const shared = groupSize.get(Math.round(block.fontSize * 2) / 2) ?? block.fontSize;
      const { size, lineHeight, lines } = fitText(text, font, Math.min(block.fontSize, Math.max(shared, 0)), block.width + pad, height);
      const [r, g, b] = block.color;
      lines.forEach((line, li) => {
        page.drawText(line, {
          x: block.x,
          y: block.y + block.height - block.fontSize * 0.95 - li * lineHeight,
          size,
          font,
          color: rgb(r, g, b),
        });
      });
    }
  }
  return doc.save();
}

async function writeTextOnly(pages: PageText[], translations: string[][], fonts: FontBytes, options: WriteOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const [W, H] = [595.28, 841.89];
  const margin = 56;
  const width = W - margin * 2;
  let page = doc.addPage([W, H]);
  let y = H - margin;

  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };

  for (const [pi, p] of pages.entries()) {
    ensure(40);
    page.drawText(`Seite ${p.index + 1}`, { x: margin, y: y - 9, size: 9, font: bold, color: rgb(0.44, 0.44, 0.47) });
    y -= 26;
    // headings (larger than the page's body text) stay bold and larger
    const body = median(p.blocks.map((b) => b.fontSize)) || 11;
    for (const [bi, block] of p.blocks.entries()) {
      const heading = block.fontSize > body * 1.2;
      const f = heading ? bold : font;
      const size = heading ? 14 : 11;
      const raw = translations[pi]?.[bi] ?? block.text;
      if (options.rasterize) {
        const img = await options.rasterize({ text: raw, width, height: H, fontSize: size, color: [0.13, 0.13, 0.16], bold: heading });
        if (img) {
          ensure(img.height);
          page.drawImage(await doc.embedPng(img.png), { x: margin, y: y - img.height, width, height: img.height });
          y -= img.height + (heading ? 6 : 10);
        }
        continue;
      }
      const text = sanitize(raw, f);
      const lines = wrapText(text, f, size, width);
      const lh = size * 1.4;
      lines.forEach((line) => {
        ensure(lh);
        page.drawText(line, { x: margin, y: y - size, size, font: f, color: rgb(0.13, 0.13, 0.16) });
        y -= lh;
      });
      y -= heading ? 6 : 10;
    }
    y -= 14;
  }
  return doc.save();
}

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
