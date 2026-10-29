// Browser-side PDF operations built on pdf-lib. Everything runs locally: no upload, works offline.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  type?: string;
}

const load = (bytes: ArrayBuffer) => PDFDocument.load(bytes, { ignoreEncryption: true });

const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

function normalizeRotation(deg: number) {
  return ((deg % 360) + 360) % 360;
}

async function copyInto(target: PDFDocument, source: PDFDocument, indices: number[], rotations?: number[]) {
  const pages = await target.copyPages(source, indices);
  pages.forEach((page, i) => {
    const extra = rotations?.[i] ?? 0;
    if (extra) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + extra)));
    target.addPage(page);
  });
}

/* ---------- merge ---------- */

export async function mergePdfs(files: { bytes: ArrayBuffer; rotation?: number }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const src = await load(file.bytes);
    const indices = src.getPageIndices();
    await copyInto(out, src, indices, indices.map(() => file.rotation ?? 0));
  }
  return out.save();
}

/* ---------- split / extract / remove ---------- */

export interface PageRange {
  from: number; // 1-based, inclusive
  to: number;
}

export async function splitByRanges(
  bytes: ArrayBuffer,
  name: string,
  ranges: PageRange[],
  mergeAll: boolean,
): Promise<OutputFile[]> {
  const src = await load(bytes);
  const count = src.getPageCount();
  const clean = ranges
    .map((r) => ({ from: Math.max(1, Math.min(r.from, count)), to: Math.max(1, Math.min(r.to, count)) }))
    .map((r) => (r.from <= r.to ? r : { from: r.to, to: r.from }));
  if (mergeAll) {
    const out = await PDFDocument.create();
    for (const r of clean) await copyInto(out, src, range(r.from - 1, r.to - 1));
    return [{ name: `${baseName(name)}_geteilt.pdf`, bytes: await out.save() }];
  }
  const files: OutputFile[] = [];
  for (const r of clean) {
    const out = await PDFDocument.create();
    await copyInto(out, src, range(r.from - 1, r.to - 1));
    const label = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`;
    files.push({ name: `${baseName(name)}_${label}.pdf`, bytes: await out.save() });
  }
  return files;
}

/** Splits into consecutive chunks of `size` pages. */
export function fixedRanges(pageCount: number, size: number): PageRange[] {
  const step = Math.max(1, Math.floor(size));
  const ranges: PageRange[] = [];
  for (let from = 1; from <= pageCount; from += step) {
    ranges.push({ from, to: Math.min(pageCount, from + step - 1) });
  }
  return ranges;
}

/** Keeps only the given 0-based pages, either as one PDF or one PDF per page. */
export async function extractPages(
  bytes: ArrayBuffer,
  name: string,
  indices: number[],
  mergeIntoOne: boolean,
): Promise<OutputFile[]> {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (mergeIntoOne) {
    const src = await load(bytes);
    const out = await PDFDocument.create();
    await copyInto(out, src, sorted);
    return [{ name: `${baseName(name)}_extrahiert.pdf`, bytes: await out.save() }];
  }
  return splitByRanges(
    bytes,
    name,
    sorted.map((i) => ({ from: i + 1, to: i + 1 })),
    false,
  );
}

export async function removePages(bytes: ArrayBuffer, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  [...new Set(indices)].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return doc.save();
}

/** Parses "1-3, 5, 8-10" into sorted unique 0-based indices within `pageCount`. */
export function parsePageList(input: string, pageCount: number): number[] {
  const result = new Set<number>();
  for (const part of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
      if (p >= 1 && p <= pageCount) result.add(p - 1);
    }
  }
  return [...result].sort((x, y) => x - y);
}

/** Formats 0-based indices as "1-3,5". */
export function formatPageList(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b).map((i) => i + 1);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(",");
}

/* ---------- organize / rotate ---------- */

export interface PageRef {
  file: number; // index into sources
  page: number; // 0-based page index in that source
  rotation: number; // extra rotation in degrees
}

export async function organizePages(sources: ArrayBuffer[], pages: PageRef[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  // Copy all pages needed from one source in a single copyPages call: pdf-lib shares fonts/images
  // only within one call, so copying page by page duplicated them (63 MB → 254 MB in tests).
  const copies = new Map<string, PDFPage[]>();
  for (let file = 0; file < sources.length; file++) {
    const refs = pages.filter((r) => r.file === file);
    if (!refs.length) continue;
    const doc = await load(sources[file]);
    const copied = await out.copyPages(doc, refs.map((r) => r.page));
    refs.forEach((r, i) => {
      const key = `${r.file}:${r.page}`;
      copies.set(key, [...(copies.get(key) ?? []), copied[i]]);
    });
  }
  for (const ref of pages) {
    const page = copies.get(`${ref.file}:${ref.page}`)!.shift()!;
    if (ref.rotation) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + ref.rotation)));
    out.addPage(page);
  }
  return out.save();
}

export async function rotatePdf(bytes: ArrayBuffer, rotation: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (normalizeRotation(rotation)) {
    for (const page of doc.getPages()) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotation)));
    }
  }
  return doc.save();
}

/* ---------- positioning helpers (respect page rotation) ---------- */

export type VPos = "top" | "middle" | "bottom";
export type HPos = "left" | "center" | "right";

/** Visible (rotated) size of a page. */
function visibleSize(page: PDFPage) {
  const { width, height } = page.getSize();
  const angle = normalizeRotation(page.getRotation().angle);
  return angle === 90 || angle === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Draws text so it appears upright at a point given in *visible* page coordinates
 * (origin bottom-left of what the reader sees), regardless of /Rotate.
 */
function drawUprightText(
  page: PDFPage,
  text: string,
  vx: number,
  vy: number,
  opts: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; opacity?: number; rotate?: number },
) {
  const { width, height } = page.getSize();
  const angle = normalizeRotation(page.getRotation().angle);
  let x = vx;
  let y = vy;
  if (angle === 90) {
    x = width - vy;
    y = vx;
  } else if (angle === 180) {
    x = width - vx;
    y = height - vy;
  } else if (angle === 270) {
    x = vy;
    y = height - vx;
  }
  page.drawText(text, {
    x,
    y,
    font: opts.font,
    size: opts.size,
    color: opts.color,
    opacity: opts.opacity,
    rotate: degrees(angle + (opts.rotate ?? 0)),
  });
}

export function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/* ---------- page numbers ---------- */

export interface PageNumberOptions {
  vertical: VPos;
  horizontal: HPos;
  margin: "small" | "medium" | "big";
  firstNumber: number;
  fromPage: number; // 1-based
  toPage: number; // 1-based
  template: string; // supports {n} and {p}
  fontSize: number;
  color: string;
  bold: boolean;
  facingPages: boolean; // mirror left/right on even pages
}

const MARGINS = { small: 18, medium: 36, big: 60 };

export async function addPageNumbers(bytes: ArrayBuffer, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const from = Math.max(1, o.fromPage);
  const to = Math.min(total, o.toPage);
  const margin = MARGINS[o.margin];
  const color = hexToRgb(o.color);
  for (let p = from; p <= to; p++) {
    const page = pages[p - 1];
    const n = o.firstNumber + (p - from);
    const text = o.template.replaceAll("{n}", String(n)).replaceAll("{p}", String(total));
    const { width, height } = visibleSize(page);
    const textWidth = font.widthOfTextAtSize(text, o.fontSize);
    let horizontal = o.horizontal;
    if (o.facingPages && n % 2 === 0 && horizontal !== "center") {
      horizontal = horizontal === "left" ? "right" : "left";
    }
    const x =
      horizontal === "left" ? margin : horizontal === "right" ? width - margin - textWidth : (width - textWidth) / 2;
    const y =
      o.vertical === "bottom" ? margin : o.vertical === "top" ? height - margin - o.fontSize : (height - o.fontSize) / 2;
    drawUprightText(page, text, x, y, { font, size: o.fontSize, color });
  }
  return doc.save();
}

/* ---------- watermark ---------- */

export interface WatermarkOptions {
  mode: "text" | "image";
  text: string;
  bold: boolean;
  italic: boolean;
  font: "Helvetica" | "Times" | "Courier";
  fontSize: number;
  color: string;
  image?: { bytes: ArrayBuffer; type: "png" | "jpg" };
  imageScale: number; // fraction of page width
  vertical: VPos;
  horizontal: HPos;
  mosaic: boolean;
  opacity: number; // 0..1
  rotation: number; // degrees, counter-clockwise like the source tool
  fromPage: number;
  toPage: number;
}

function pickFont(o: WatermarkOptions) {
  const map = {
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  } as const;
  return map[o.font][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)];
}

export async function addWatermark(bytes: ArrayBuffer, o: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const from = Math.max(1, o.fromPage);
  const to = Math.min(pages.length, o.toPage);
  const font = o.mode === "text" ? await doc.embedFont(pickFont(o)) : null;
  const image =
    o.mode === "image" && o.image
      ? o.image.type === "png"
        ? await doc.embedPng(o.image.bytes)
        : await doc.embedJpg(o.image.bytes)
      : null;
  const color = hexToRgb(o.color);

  for (let p = from; p <= to; p++) {
    const page = pages[p - 1];
    const { width, height } = visibleSize(page);
    let boxW: number;
    let boxH: number;
    if (font) {
      boxW = font.widthOfTextAtSize(o.text, o.fontSize);
      boxH = font.heightAtSize(o.fontSize, { descender: false });
    } else if (image) {
      boxW = width * o.imageScale;
      boxH = (image.height / image.width) * boxW;
    } else {
      continue;
    }

    const centers: { cx: number; cy: number }[] = [];
    if (o.mosaic) {
      const stepX = Math.max(boxW * 1.6, 120);
      const stepY = Math.max(boxH * 4, 120);
      for (let cy = stepY / 2; cy < height; cy += stepY) {
        for (let cx = stepX / 2; cx < width; cx += stepX) centers.push({ cx, cy });
      }
    } else {
      const pad = 24;
      const cx = o.horizontal === "left" ? pad + boxW / 2 : o.horizontal === "right" ? width - pad - boxW / 2 : width / 2;
      const cy = o.vertical === "bottom" ? pad + boxH / 2 : o.vertical === "top" ? height - pad - boxH / 2 : height / 2;
      centers.push({ cx, cy });
    }

    const angle = normalizeRotation(page.getRotation().angle);
    const rad = (o.rotation * Math.PI) / 180;
    for (const { cx, cy } of centers) {
      // bottom-left corner so that the rotated box stays centered on (cx, cy)
      const vx = cx - (boxW / 2) * Math.cos(rad) + (boxH / 2) * Math.sin(rad);
      const vy = cy - (boxW / 2) * Math.sin(rad) - (boxH / 2) * Math.cos(rad);
      if (font) {
        drawUprightText(page, o.text, vx, vy, { font, size: o.fontSize, color, opacity: o.opacity, rotate: o.rotation });
      } else if (image) {
        const { width: pw, height: ph } = page.getSize();
        let x = vx;
        let y = vy;
        if (angle === 90) [x, y] = [pw - vy, vx];
        else if (angle === 180) [x, y] = [pw - vx, ph - vy];
        else if (angle === 270) [x, y] = [vy, ph - vx];
        page.drawImage(image, { x, y, width: boxW, height: boxH, opacity: o.opacity, rotate: degrees(angle + o.rotation) });
      }
    }
  }
  return doc.save();
}

/* ---------- crop ---------- */

/** Fractions (0..1) of the *visible* page, measured from its top-left corner. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export async function cropPdf(bytes: ArrayBuffer, rect: CropRect, pageIndices: number[] | "all"): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const targets = pageIndices === "all" ? pages.map((_, i) => i) : pageIndices;
  for (const i of targets) {
    const page = pages[i];
    const box = page.getCropBox();
    const angle = normalizeRotation(page.getRotation().angle);
    // Map the visible-space rect back to unrotated user space.
    let { left, top, width, height } = rect;
    if (angle === 90) [left, top, width, height] = [top, 1 - left - width, height, width];
    else if (angle === 180) [left, top] = [1 - left - width, 1 - top - height];
    else if (angle === 270) [left, top, width, height] = [1 - top - height, left, height, width];
    const x = box.x + left * box.width;
    const y = box.y + (1 - top - height) * box.height;
    const w = width * box.width;
    const h = height * box.height;
    page.setCropBox(x, y, w, h);
    page.setMediaBox(x, y, w, h);
  }
  return doc.save();
}

/* ---------- images to PDF ---------- */

export interface ImagesToPdfOptions {
  orientation: "portrait" | "landscape";
  pageSize: "fit" | "A4" | "letter";
  margin: "none" | "small" | "big";
  mergeAll: boolean;
}

const PAGE_SIZES = { A4: [595.28, 841.89], letter: [612, 792] } as const;
const IMAGE_MARGINS = { none: 0, small: 20, big: 50 };

export interface PreparedImage {
  name: string;
  bytes: ArrayBuffer;
  type: "png" | "jpg";
  rotation: number;
}

export async function imagesToPdf(images: PreparedImage[], o: ImagesToPdfOptions): Promise<OutputFile[]> {
  const draw = async (doc: PDFDocument, img: PreparedImage) => {
    const embedded = img.type === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const quarter = normalizeRotation(img.rotation) % 180 !== 0;
    const iw = quarter ? embedded.height : embedded.width;
    const ih = quarter ? embedded.width : embedded.height;
    const margin = IMAGE_MARGINS[o.margin];
    let pw: number;
    let ph: number;
    if (o.pageSize === "fit") {
      pw = iw + margin * 2;
      ph = ih + margin * 2;
    } else {
      const [a, b] = PAGE_SIZES[o.pageSize];
      [pw, ph] = o.orientation === "portrait" ? [a, b] : [b, a];
    }
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih, o.pageSize === "fit" ? 1 : Infinity);
    const w = iw * scale;
    const h = ih * scale;
    const x = (pw - w) / 2;
    const y = (ph - h) / 2;
    const r = normalizeRotation(img.rotation);
    // drawImage rotates (clockwise here) around the bottom-left corner; offset so the result fills (x, y, w, h).
    const dw = quarter ? h : w;
    const dh = quarter ? w : h;
    const pos =
      r === 90 ? { x, y: y + h } : r === 180 ? { x: x + w, y: y + h } : r === 270 ? { x: x + w, y } : { x, y };
    page.drawImage(embedded, { ...pos, width: dw, height: dh, rotate: degrees(-r) });
  };

  if (o.mergeAll) {
    const doc = await PDFDocument.create();
    for (const img of images) await draw(doc, img);
    return [{ name: images.length === 1 ? `${baseName(images[0].name)}.pdf` : "bilder.pdf", bytes: await doc.save() }];
  }
  const out: OutputFile[] = [];
  for (const img of images) {
    const doc = await PDFDocument.create();
    await draw(doc, img);
    out.push({ name: `${baseName(img.name)}.pdf`, bytes: await doc.save() });
  }
  return out;
}

/** Converts any browser-decodable image to PNG/JPEG bytes pdf-lib can embed. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bytes = await file.arrayBuffer();
  if (file.type === "image/jpeg") return { name: file.name, bytes, type: "jpg", rotation: 0 };
  if (file.type === "image/png") return { name: file.name, bytes, type: "png", rotation: 0 };
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird nicht unterstützt");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht konvertiert werden"))), "image/jpeg", 0.92),
  );
  return { name: file.name, bytes: await blob.arrayBuffer(), type: "jpg", rotation: 0 };
}

export async function getPageCount(bytes: ArrayBuffer): Promise<number> {
  return (await load(bytes)).getPageCount();
}
