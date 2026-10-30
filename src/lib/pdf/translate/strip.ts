// Removes original text from a page's content streams (instead of painting boxes over it), so images,
// gradients and lines behind the text stay exactly as they were.
// Each text-showing operator whose glyphs lie in one of the given boxes is replaced by a TJ that only
// advances the text position by the same width ("[-1234] TJ"): later text on the same line keeps its place.
// Text inside Form XObjects (Canva, InDesign …) is handled by giving the page its own edited copy of the form.
import { Encodings, Font, type IFontNames } from "@pdf-lib/standard-fonts";
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";
import type { Rect } from "./layout";

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** apply n first, then m (same convention as pdf.js' Util.transform) */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ---------- tokenizer ----------

type Token =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "str"; v: Uint8Array; s: number; e: number }
  | { t: "name"; v: string; s: number; e: number }
  | { t: "op"; v: string; s: number; e: number }
  | { t: "open" | "close" | "dopen" | "dclose"; s: number; e: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...WS, 0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function* tokens(b: Uint8Array): Generator<Token> {
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    if (WS.has(c)) {
      i++;
    } else if (c === 0x25) {
      while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; // comment
    } else if (c === 0x28) {
      const s = i;
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < b.length && depth > 0) {
        let ch = b[i++];
        if (ch === 0x5c) {
          const n = b[i++];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (n in map) ch = map[n];
          else if (n >= 0x30 && n <= 0x37) {
            let oct = n - 0x30;
            for (let k = 0; k < 2 && b[i] >= 0x30 && b[i] <= 0x37; k++) oct = oct * 8 + (b[i++] - 0x30);
            ch = oct & 0xff;
          } else if (n === 13 || n === 10) {
            if (n === 13 && b[i] === 10) i++;
            continue; // line continuation
          } else ch = n;
        } else if (ch === 0x28) depth++;
        else if (ch === 0x29 && --depth === 0) break;
        out.push(ch);
      }
      yield { t: "str", v: Uint8Array.from(out), s, e: i };
    } else if (c === 0x3c && b[i + 1] === 0x3c) {
      yield { t: "dopen", s: i, e: i + 2 };
      i += 2;
    } else if (c === 0x3e && b[i + 1] === 0x3e) {
      yield { t: "dclose", s: i, e: i + 2 };
      i += 2;
    } else if (c === 0x3c) {
      const s = i;
      let hex = "";
      for (i++; i < b.length && b[i] !== 0x3e; i++) if (!WS.has(b[i])) hex += String.fromCharCode(b[i]);
      i++;
      if (hex.length % 2) hex += "0";
      yield { t: "str", v: Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)), s, e: i };
    } else if (c === 0x5b || c === 0x5d) {
      yield { t: c === 0x5b ? "open" : "close", s: i, e: i + 1 };
      i++;
    } else if (c === 0x7b || c === 0x7d || c === 0x3e) {
      i++;
    } else {
      const s = i;
      i++;
      while (i < b.length && !DELIM.has(b[i])) i++;
      const word = String.fromCharCode(...b.subarray(s, i));
      if (c === 0x2f) yield { t: "name", v: word.slice(1), s, e: i };
      else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) yield { t: "num", v: parseFloat(word), s, e: i };
      else {
        yield { t: "op", v: word, s, e: i };
        if (word === "ID") {
          // inline image data: skip to the EI that ends it
          i++;
          while (i < b.length && !(b[i] === 0x45 && b[i + 1] === 0x49 && WS.has(b[i - 1]) && (i + 2 >= b.length || WS.has(b[i + 2])))) i++;
          i += 2;
        }
      }
    }
  }
}

type Operand = Token | Operand[];

// ---------- fonts ----------

interface FontInfo {
  bytes: 1 | 2;
  /** glyph width in 1/1000 text space units, or undefined if unknown */
  width: (code: number) => number | undefined;
}

const STANDARD: Record<string, IFontNames> = {};
for (const n of [
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Helvetica", "Helvetica-Bold", "Helvetica-Oblique",
  "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Symbol", "ZapfDingbats",
]) STANDARD[n] = n as IFontNames;
let winAnsiNames: Map<number, string> | undefined;

function fontInfo(dict: PDFDict | undefined): FontInfo | undefined {
  if (!dict) return undefined;
  const num = (o: unknown) => (o instanceof PDFNumber ? o.asNumber() : undefined);
  const subtype = String(dict.get(PDFName.of("Subtype")) ?? "");
  if (subtype === "/Type0") {
    const desc = dict.lookup(PDFName.of("DescendantFonts"), PDFArray)?.lookup(0, PDFDict);
    const dw = num(desc?.lookup(PDFName.of("DW"))) ?? 1000;
    const widths = new Map<number, number>();
    const w = desc?.lookup(PDFName.of("W"));
    if (w instanceof PDFArray) {
      const a = w.asArray().map((o) => desc!.context.lookup(o));
      for (let k = 0; k < a.length; ) {
        const first = num(a[k]);
        if (first === undefined) break;
        if (a[k + 1] instanceof PDFArray) {
          (a[k + 1] as PDFArray).asArray().forEach((x, j) => widths.set(first + j, num(desc!.context.lookup(x)) ?? dw));
          k += 2;
        } else {
          const last = num(a[k + 1]) ?? first;
          const width = num(a[k + 2]) ?? dw;
          for (let c = first; c <= last; c++) widths.set(c, width);
          k += 3;
        }
      }
    }
    return { bytes: 2, width: (c) => widths.get(c) ?? dw };
  }
  const widthsArr = dict.lookup(PDFName.of("Widths"));
  if (widthsArr instanceof PDFArray) {
    const first = num(dict.lookup(PDFName.of("FirstChar"))) ?? 0;
    const ws = widthsArr.asArray().map((o) => num(dict.context.lookup(o)) ?? 0);
    const descriptor = dict.lookup(PDFName.of("FontDescriptor"));
    const missing = descriptor instanceof PDFDict ? num(descriptor.lookup(PDFName.of("MissingWidth"))) : undefined;
    // Type3 widths are in glyph space
    const fm = dict.lookup(PDFName.of("FontMatrix"));
    const scale = subtype === "/Type3" && fm instanceof PDFArray ? (num(fm.lookup(0)) ?? 0.001) * 1000 : 1;
    return { bytes: 1, width: (c) => (ws[c - first] ?? missing ?? 0) * scale };
  }
  const base = String(dict.get(PDFName.of("BaseFont")) ?? "").replace(/^\//, "");
  if (STANDARD[base]) {
    const font = Font.load(STANDARD[base]);
    if (!winAnsiNames) {
      winAnsiNames = new Map();
      for (const cp of Encodings.WinAnsi.supportedCodePoints) {
        const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
        winAnsiNames.set(code, name);
      }
    }
    return { bytes: 1, width: (c) => font.getWidthOfGlyph(winAnsiNames!.get(c) ?? "space") || 0 };
  }
  return undefined;
}

// ---------- page rewriting ----------

const cmyk = ([c, m, y, k]: number[]): Rgb => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];

type Rgb = [number, number, number];

interface GState {
  ctm: Matrix;
  /** fill color (text is drawn with it) */
  fill: Rgb;
  font?: FontInfo;
  fontKnown: boolean;
  size: number;
  tc: number;
  tw: number;
  tz: number;
  tl: number;
  tr: number;
}

interface Edit {
  s: number;
  e: number;
  text: string;
}

interface Context {
  doc: PDFDocument;
  boxes: Rect[];
  /** characters removed per box */
  removed: number[];
  /** fill color of the first removed text per box */
  colors: (Rgb | undefined)[];
  formCopies: number;
}

function decode(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  // streams created by pdf-lib (e.g. its q/Q wrapper): getContents() would be the compressed bytes
  const own = stream as unknown as { getUnencodedContents?: () => Uint8Array; getContents(): Uint8Array };
  return own.getUnencodedContents ? own.getUnencodedContents() : own.getContents();
}

/** Rewrites one content stream; returns the edited bytes, or null if nothing changed. */
function rewrite(bytes: Uint8Array, resources: PDFDict | undefined, ctm: Matrix, ctx: Context): Uint8Array | null {
  const edits: Edit[] = [];
  const stack: GState[] = [];
  let g: GState = { ctm, fill: [0, 0, 0], fontKnown: false, size: 0, tc: 0, tw: 0, tz: 1, tl: 0, tr: 0 };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let operands: Operand[] = [];
  const nested: Operand[][] = [];
  let operandStart = 0;
  const fonts = resources?.lookup(PDFName.of("Font"));
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  const fontCache = new Map<string, FontInfo | undefined>();

  const nums = () => operands.map((o) => (!Array.isArray(o) && o.t === "num" ? o.v : 0));
  const td = (tx: number, ty: number) => {
    tlm = mul(tlm, [1, 0, 0, 1, tx, ty]);
    tm = tlm;
  };

  // Shows a string; returns its advance (text space) and whether its middle lies in a box.
  const show = (str: Uint8Array) => {
    const f = g.font;
    let adv = 0;
    let chars = 0;
    let known = !!f;
    for (let k = 0; f && k + f.bytes <= str.length; k += f.bytes) {
      const code = f.bytes === 2 ? (str[k] << 8) | str[k + 1] : str[k];
      const w = f.width(code);
      if (w === undefined) known = false;
      adv += ((w ?? 500) / 1000) * g.size + g.tc + (f.bytes === 1 && code === 32 ? g.tw : 0);
      chars++;
    }
    return { adv, chars, known };
  };
  const boxAt = (advText: number) => {
    const m = mul(g.ctm, tm);
    const [x0, y0] = apply(m, 0, 0);
    const [x1, y1] = apply(m, advText * g.tz, 0);
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return ctx.boxes.findIndex((b) => mx >= b.x - 2 && mx <= b.x + b.width + 2 && my >= b.y - 2 && my <= b.y + b.height + 2);
  };

  /** Handles Tj/TJ/'/" : edits the operator span if its text lies in a box. */
  const showOp = (items: Operand[], prefix: string, end: number) => {
    let total = 0;
    let chars = 0;
    let known = true;
    for (const it of items) {
      if (Array.isArray(it)) continue;
      if (it.t === "str") {
        const r = show(it.v);
        total += r.adv;
        chars += r.chars;
        known &&= r.known;
      } else if (it.t === "num") total -= (it.v / 1000) * g.size;
    }
    const box = chars ? boxAt(total) : -1;
    if (box >= 0) {
      ctx.removed[box] += chars;
      ctx.colors[box] ??= g.fill;
      // same advance without glyphs; if the font's widths are unknown, draw the text invisibly instead
      const advance = known && g.size ? `[${(-(total / g.size) * 1000).toFixed(3)}] TJ` : null;
      const original = String.fromCharCode(...bytes.subarray(operandStart, end));
      edits.push({
        s: operandStart,
        e: end,
        text: advance ? ` ${prefix}${advance} ` : ` ${g.tr >= 4 ? 7 : 3} Tr ${original} ${g.tr} Tr `,
      });
    }
    tm = mul(tm, [1, 0, 0, 1, total * g.tz, 0]);
  };

  for (const tok of tokens(bytes)) {
    if (tok.t === "open" || tok.t === "dopen") {
      nested.push(operands);
      operands = [];
      continue;
    }
    if (tok.t === "close" || tok.t === "dclose") {
      const inner = operands;
      operands = nested.pop() ?? [];
      operands.push(inner);
      continue;
    }
    if (tok.t !== "op") {
      if (!nested.length && !operands.length) operandStart = tok.s;
      operands.push(tok);
      continue;
    }
    if (nested.length) continue; // malformed
    if (!operands.length) operandStart = tok.s;
    const n = nums();
    switch (tok.v) {
      case "q":
        stack.push({ ...g });
        break;
      case "Q":
        g = stack.pop() ?? g;
        break;
      case "rg":
        g.fill = [n[0], n[1], n[2]];
        break;
      case "g":
        g.fill = [n[0], n[0], n[0]];
        break;
      case "k":
        g.fill = cmyk(n);
        break;
      case "cs":
        g.fill = [0, 0, 0];
        break;
      case "sc":
      case "scn": {
        const v = operands.filter((o) => !Array.isArray(o) && o.t === "num").map((o) => (o as { v: number }).v);
        if (v.length === 1) g.fill = [v[0], v[0], v[0]];
        else if (v.length === 3) g.fill = [v[0], v[1], v[2]];
        else if (v.length === 4) g.fill = cmyk(v);
        break;
      }
      case "cm":
        g.ctm = mul(g.ctm, n.slice(0, 6) as Matrix);
        break;
      case "BT":
        tm = tlm = IDENTITY;
        break;
      case "Tm":
        tm = tlm = n.slice(0, 6) as Matrix;
        break;
      case "Td":
        td(n[0], n[1]);
        break;
      case "TD":
        g.tl = -n[1];
        td(n[0], n[1]);
        break;
      case "T*":
        td(0, -g.tl);
        break;
      case "TL":
        g.tl = n[0];
        break;
      case "Tc":
        g.tc = n[0];
        break;
      case "Tw":
        g.tw = n[0];
        break;
      case "Tz":
        g.tz = n[0] / 100;
        break;
      case "Tr":
        g.tr = n[0];
        break;
      case "Tf": {
        const name = operands[0] && !Array.isArray(operands[0]) && operands[0].t === "name" ? operands[0].v : "";
        if (!fontCache.has(name)) fontCache.set(name, fonts instanceof PDFDict ? fontInfo(fonts.lookup(PDFName.of(name)) as PDFDict | undefined) : undefined);
        g.font = fontCache.get(name);
        g.size = n[1];
        break;
      }
      case "Tj":
        showOp(operands.slice(-1), "", tok.e);
        break;
      case "TJ":
        showOp((operands[operands.length - 1] as Operand[]) ?? [], "", tok.e);
        break;
      case "'":
        td(0, -g.tl);
        showOp(operands.slice(-1), "T* ", tok.e);
        break;
      case '"':
        g.tw = n[0];
        g.tc = n[1];
        td(0, -g.tl);
        showOp(operands.slice(-1), `${n[0]} Tw ${n[1]} Tc T* `, tok.e);
        break;
      case "Do": {
        const nameTok = operands[0];
        if (!nameTok || Array.isArray(nameTok) || nameTok.t !== "name" || !(xobjects instanceof PDFDict)) break;
        const ref = xobjects.get(PDFName.of(nameTok.v));
        const form = xobjects.lookup(PDFName.of(nameTok.v));
        if (!(form instanceof PDFStream) || String(form.dict.get(PDFName.of("Subtype"))) !== "/Form") break;
        const fm = form.dict.lookup(PDFName.of("Matrix"));
        const matrix = fm instanceof PDFArray ? (fm.asArray().map((o) => (o instanceof PDFNumber ? o.asNumber() : 0)) as Matrix) : IDENTITY;
        const formRes = form.dict.lookup(PDFName.of("Resources"));
        const edited = rewrite(decode(form), formRes instanceof PDFDict ? formRes : resources, mul(g.ctm, matrix), ctx);
        if (edited && ref instanceof PDFRef) {
          // the form may be shared with other pages: give this use its own edited copy
          const dict: Record<string, unknown> = {};
          for (const [k, v] of form.dict.entries()) if (!["/Length", "/Filter", "/DecodeParms"].includes(String(k))) dict[String(k).slice(1)] = v;
          const copy = ctx.doc.context.register(ctx.doc.context.flateStream(edited, dict as never));
          const newName = `${nameTok.v}_tr${++ctx.formCopies}`;
          xobjects.set(PDFName.of(newName), copy);
          edits.push({ s: nameTok.s, e: nameTok.e, text: `/${newName}` });
        }
        break;
      }
    }
    operands = [];
    operandStart = tok.e;
  }

  if (!edits.length) return null;
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const ed of edits.sort((a, b) => a.s - b.s)) {
    parts.push(bytes.subarray(pos, ed.s), Uint8Array.from(ed.text, (ch) => ch.charCodeAt(0)));
    pos = ed.e;
  }
  parts.push(bytes.subarray(pos));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Removes the text inside `boxes` (user space) from the page. Returns how many characters were
 * removed per box — a box with (almost) none needs to be covered the old way — and the text color
 * found in the PDF for each box.
 */
export function removeTextInBoxes(doc: PDFDocument, page: PDFPage, boxes: Rect[]): { removed: number[]; colors: (Rgb | undefined)[] } {
  const ctx: Context = { doc, boxes, removed: boxes.map(() => 0), colors: boxes.map(() => undefined), formCopies: 0 };
  if (!boxes.length) return ctx;
  // normalizing first matters: pdf-lib wraps the original content in q … Q there, which must survive
  // in the edited stream (else a transform left open by the original would distort the translation)
  const resources = page.node.normalizedEntries().Resources; // includes inherited resources
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const parts = streams.filter((s): s is PDFStream => s instanceof PDFStream).map(decode);
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let o = 0;
  for (const p of parts) {
    joined.set(p, o);
    joined[o + p.length] = 10;
    o += p.length + 1;
  }
  const edited = rewrite(joined, resources, IDENTITY, ctx);
  // an array: pdf-lib appends its own content streams to it when the translation is drawn
  if (edited) page.node.set(PDFName.of("Contents"), doc.context.obj([doc.context.register(doc.context.flateStream(edited))]));
  return ctx;
}
