// Engine-independent pre- and post-processing for translation.
// Splits block texts into translatable units, protects parts that must not be translated
// (bullets, TOC page numbers, numbers, URLs) and cleans typical machine-translation artifacts.

export interface Unit {
  /** text sent to the engine ("" = keep `original` as is) */
  core: string;
  prefix: string;
  suffix: string;
  /** the original was written in capitals → upper-case the translation */
  caps: boolean;
  original: string;
}

const TOC_TAIL = /(\s*(?:\.{3,}|…{2,})\s*|\s+(?:p|pp|pag|pg|s|seite|page)\.?\s*)(\d{1,4})$/i;
const BULLET = /^(•\s*|\d{1,3}[.)]\s+)/;
const NOT_LANGUAGE =
  /^(?:[\d\s.,:;/%+\-–—()€$£°x×=]+|[\d\s.,/\-–]+\s*(?:g|gr|kg|mg|ml|cl|dl|l|cm|mm|m|km|min|h|pz|pcs|stk|°c?)\.?|https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+)$/i;

/** "FARINE PER USO DOMESTICO" → "Farine per uso domestico" */
function sentenceCase(text: string) {
  const lower = text.toLocaleLowerCase();
  return lower.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase());
}

function isCaps(text: string) {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 4) return false;
  const upper = letters.filter((c) => c === c.toLocaleUpperCase() && c !== c.toLocaleLowerCase()).length;
  return upper / letters.length > 0.85;
}

export function toUnit(line: string): Unit {
  let core = line.trim();
  let prefix = "";
  let suffix = "";
  const b = core.match(BULLET);
  if (b) {
    prefix = b[0];
    core = core.slice(b[0].length);
  }
  const toc = core.match(TOC_TAIL);
  if (toc && core.length > toc[0].length + 2) {
    suffix = toc[0];
    core = core.slice(0, -toc[0].length);
  }
  if (!/\p{L}{2}/u.test(core) || NOT_LANGUAGE.test(core)) return { core: "", prefix: "", suffix: "", caps: false, original: line };
  const caps = isCaps(core);
  return { core: caps ? sentenceCase(core) : core, prefix, suffix, caps, original: line };
}

/** Removes repetition loops and junk tails that small translation models sometimes produce. */
export function cleanTranslation(text: string, source: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  const LOOP = /[.…,;:!?](?:\s*[.…,;:!?]){3,}/u;
  // cut at the first run of 4+ punctuation marks (".....", ". . . .", ".,.,") — a repetition loop —
  // unless the source itself contains such a run (e.g. dot leaders)
  if (!LOOP.test(source)) {
    const m = t.match(LOOP);
    if (m && m.index !== undefined && m.index > 0) {
      const end = /[.!?…]$/.test(source.trim()) ? source.trim().slice(-1) : "";
      t = t.slice(0, m.index).trimEnd() + end;
    }
  }
  // collapse a word or short phrase (3+ chars) repeated 3+ times in a row
  t = t.replace(/(\p{L}[\p{L}\d\s,'-]{2,40}?)(?:\s*\1){2,}/gu, "$1");
  return t;
}

export interface GlossaryEntry {
  from: string;
  to: string;
}

/** Parses lines like "pasta frolla = Mürbeteig" (also "→", "->", ";"). */
export function parseGlossary(text: string): GlossaryEntry[] {
  return text
    .split(/\n/)
    .map((line) => line.split(/\s*(?:=|→|->|;)\s*/))
    .filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim())
    .map(([from, to]) => ({ from: from.trim(), to: to.trim() }))
    .sort((a, b) => b.from.length - a.from.length); // longest first: "pasta frolla" before "pasta"
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces glossary terms in the source text with the desired translation before it is sent to the
 * engine. Small translation models pass such (for them unknown) words through unchanged, which fixes
 * technical terms they would otherwise garble ("pasta frolla" → "Mürbeteig").
 */
export function applyGlossary(text: string, glossary: GlossaryEntry[]): string {
  let out = text;
  for (const { from, to } of glossary) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRe(from)}(?![\\p{L}\\d])`, "giu"), (match) =>
      match[0] === match[0].toLocaleUpperCase() ? to[0].toLocaleUpperCase() + to.slice(1) : to,
    );
  }
  return out;
}

export interface Plan {
  /** per block: units per line */
  blocks: Unit[][];
  /** unique texts to translate */
  queue: string[];
}

export function planTranslation(blockTexts: string[], glossary: GlossaryEntry[] = []): Plan {
  const seen = new Map<string, number>();
  const queue: string[] = [];
  const blocks = blockTexts.map((text) =>
    text.split("\n").map((line) => {
      const unit = toUnit(line);
      if (unit.core && glossary.length) unit.core = applyGlossary(unit.core, glossary);
      if (unit.core && !seen.has(unit.core)) {
        seen.set(unit.core, queue.length);
        queue.push(unit.core);
      }
      return unit;
    }),
  );
  return { blocks, queue };
}

/** Puts translated queue items back together into block texts (lines joined with "\n"). */
export function assemble(plan: Plan, translated: string[]): string[] {
  const index = new Map(plan.queue.map((q, i) => [q, i]));
  return plan.blocks.map((units) =>
    units
      .map((u) => {
        if (!u.core) return u.original;
        let t = cleanTranslation(translated[index.get(u.core)!] ?? u.core, u.core) || u.core;
        if (u.caps) t = t.toLocaleUpperCase();
        return u.prefix + t + u.suffix;
      })
      .join("\n"),
  );
}

/**
 * Tesseract confuses c/C, s/S, o/O … in display fonts ("SUCCesso"). A word that is neither lower case,
 * Capitalized nor ALL CAPS is turned into lower case, keeping a capital first letter.
 */
export function fixCase(word: string) {
  const letters = word.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || /^\p{Lu}?\p{Ll}*$/u.test(letters) || /^\p{Lu}+$/u.test(letters)) return word;
  const lower = word.toLowerCase();
  const first = word.search(/\p{L}/u);
  return /\p{Lu}/u.test(word[first]) ? lower.slice(0, first) + lower[first].toUpperCase() + lower.slice(first + 1) : lower;
}
