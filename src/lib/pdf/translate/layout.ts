// Pure text-layout helpers: group positioned text runs into lines and paragraph blocks.
// No DOM access, so they run in the browser and in Node tests alike.

export interface Run {
  x: number;
  y: number; // baseline
  right: number;
  size: number;
  str: string;
  /** pdf.js font id, used to carry bold/serif over to the translation */
  font?: string;
}

export interface Line {
  x: number;
  right: number;
  y: number;
  size: number;
  runs: Run[];
  text: string;
}

export const isHorizontal = (t: number[]) => Math.abs(t[1]) < 1e-3 && Math.abs(t[2]) < 1e-3 && t[0] > 0 && t[3] > 0;

export function joinRuns(runs: Run[]): string {
  let out = "";
  let prev: Run | null = null;
  for (const r of runs) {
    if (prev) {
      const gap = r.x - prev.right;
      const needsSpace = gap > r.size * 0.18 && !out.endsWith(" ") && !r.str.startsWith(" ");
      if (needsSpace) out += " ";
    }
    out += r.str;
    prev = r;
  }
  return out.replace(/\s+/g, " ").trim();
}

export function buildLines(runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const run of sorted) {
    // same baseline, close enough horizontally (a large gap means another column/table cell)
    const line = lines.find(
      (l) =>
        Math.abs(l.y - run.y) < Math.max(l.size, run.size) * 0.35 &&
        run.x >= l.x - run.size &&
        run.x - l.right < Math.max(l.size, run.size) * 1.5,
    );
    if (line) {
      line.runs.push(run);
      line.right = Math.max(line.right, run.right);
      line.x = Math.min(line.x, run.x);
      line.size = Math.max(line.size, run.size);
    } else {
      lines.push({ x: run.x, right: run.right, y: run.y, size: run.size, runs: [run], text: "" });
    }
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    l.text = joinRuns(l.runs);
  }
  return lines.filter((l) => l.text.length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
}

export interface Group {
  lines: Line[];
  x: number;
  right: number;
  size: number;
}

/** Table-of-contents style line: ends with a page number after dot leaders or "p./S./pag.". */
export const isTocLine = (text: string) => /(\.{3,}|…{2,}|\s(p|pp|pag|pg|s|seite|page)\.?)\s*\d{1,4}$/i.test(text.trim());

export function buildBlocks(lines: Line[]): Group[] {
  const groups: Group[] = [];
  // Table cells: short lines that share their baseline with other lines (a row of a table). Each one
  // stays a block of its own, so translated cells keep their column. Lines of a two-column page
  // layout also share baselines, but they are long and still form paragraphs.
  const isCell = (l: Line) => l.right - l.x < l.size * 12 && lines.some((o) => o !== l && Math.abs(o.y - l.y) < l.size * 0.35);
  const cells = new Set(lines.filter(isCell));
  for (const line of lines) {
    // TOC entries stay one block per line so page numbers keep their position
    if (isTocLine(line.text) || cells.has(line)) {
      groups.push({ lines: [line], x: line.x, right: line.right, size: line.size });
      continue;
    }
    const target = groups.find((g) => {
      if (isTocLine(g.lines[g.lines.length - 1].text) || cells.has(g.lines[0])) return false;
      const last = g.lines[g.lines.length - 1];
      const gap = last.y - line.y;
      const similarSize = Math.max(g.size, line.size) / Math.min(g.size, line.size) < 1.25;
      const overlaps = line.x < g.right && line.right > g.x;
      const alignedLeft = Math.abs(line.x - g.x) < g.size * 3;
      return similarSize && gap > 0 && gap < g.size * 1.9 && overlaps && alignedLeft;
    });
    if (target) {
      target.lines.push(line);
      target.x = Math.min(target.x, line.x);
      target.right = Math.max(target.right, line.right);
    } else {
      groups.push({ lines: [line], x: line.x, right: line.right, size: line.size });
    }
  }
  return groups;
}

/** Private-use / symbol-font bullets (Wingdings, Symbol) and common bullets → "•". */
const BULLETS = /^[•●▪■–—\-*·▪►■●◦]\s*/;
export const normalizeBullet = (text: string) => text.replace(BULLETS, "• ");

/**
 * Joins the lines of a block. Wrapped lines of a paragraph are joined with a space (removing
 * end-of-line hyphenation); a line that ends clearly before the block's right edge, or a following
 * line that starts with a bullet/number, is a real line break and kept as "\n" (lists, recipes, addresses).
 */
export function groupText(lines: Line[]): string {
  const right = Math.max(...lines.map((l) => l.right));
  const left = Math.min(...lines.map((l) => l.x));
  const width = Math.max(1, right - left);
  let text = "";
  lines.forEach((l, i) => {
    const current = normalizeBullet(l.text);
    if (i === 0) {
      text = current;
      return;
    }
    const prev = lines[i - 1];
    const prevShort = prev.right < left + width * 0.82;
    const startsItem = BULLETS.test(l.text) || /^\d{1,4}\s*(gr?|kg|ml|l|cl|dl|g|pz|stk|x)?\b/i.test(l.text) || /^\d+[.)]\s/.test(l.text);
    if (prevShort || startsItem) text += "\n" + current;
    else if (/\p{Ll}-$/u.test(text) && /^\p{Ll}/u.test(current)) text = text.slice(0, -1) + current;
    else text += " " + current;
  });
  return text;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Unites touching or nearby images: headlines are often cut into several image pieces, which would
 * be read word by word (or letter by letter) otherwise. Overlapping masks/photos become one area too.
 */
export function mergeRects(rects: Rect[], gap = 6): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  const near = (a: Rect, b: Rect) =>
    a.x - gap <= b.x + b.width && b.x - gap <= a.x + a.width && a.y - gap <= b.y + b.height && b.y - gap <= a.y + a.height;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!near(out[i], out[j])) continue;
        const [a, b] = [out[i], out[j]];
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        out[i] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        out.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return out;
}
