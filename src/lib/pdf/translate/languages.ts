// Languages for the PDF translator.
// - code: ISO 639-1 / BCP 47 (UI, Chrome/Edge Translator API)
// - mul: target token of the multilingual Opus model Xenova/opus-mt-en-mul (">>mul<<"), if supported
// - franc: ISO 639-3 code returned by franc-min (language detection)
// - script: decides how translated text is drawn: Latin/Greek/Cyrillic/Armenian/Georgian with the bundled
//   DejaVu font (selectable text); other scripts are rendered with the device's own fonts as images.
// - ocr: Tesseract language bundled in public/tesseract/lang
import { franc } from "franc-min";

export type Script = "latn" | "grek" | "cyrl" | "armn" | "geor" | "arab" | "hebr" | "deva" | "thai" | "cjk" | "hang";

export interface Language {
  code: string;
  label: string;
  name: string;
  franc: string;
  script: Script;
  mul?: string;
  ocr?: string;
}

const L = (code: string, label: string, name: string, franc: string, script: Script, mul?: string, ocr?: string): Language => ({
  code,
  label,
  name,
  franc,
  script,
  mul,
  ocr,
});

export const LANGUAGES: Language[] = [
  L("af", "Afrikaans", "Afrikaans", "afr", "latn", "afr"),
  L("sq", "Albanisch", "Albanian", "als", "latn", "sqi"),
  L("ar", "Arabisch", "Arabic", "arb", "arab", "ara"),
  L("hy", "Armenisch", "Armenian", "hye", "armn", "hye"),
  L("eu", "Baskisch", "Basque", "eus", "latn", "eus"),
  L("bs", "Bosnisch", "Bosnian", "bos", "latn", "bos_Latn"),
  L("bg", "Bulgarisch", "Bulgarian", "bul", "cyrl", "bul"),
  L("zh", "Chinesisch", "Chinese", "cmn", "cjk", "cmn_Hans"),
  L("da", "Dänisch", "Danish", "dan", "latn", "dan"),
  L("de", "Deutsch", "German", "deu", "latn", "deu", "deu"),
  L("en", "Englisch", "English", "eng", "latn", undefined, "eng"),
  L("eo", "Esperanto", "Esperanto", "epo", "latn", "epo"),
  L("et", "Estnisch", "Estonian", "est", "latn", "est"),
  L("fi", "Finnisch", "Finnish", "fin", "latn", "fin"),
  L("fr", "Französisch", "French", "fra", "latn", "fra", "fra"),
  L("gl", "Galicisch", "Galician", "glg", "latn", "glg"),
  L("ka", "Georgisch", "Georgian", "kat", "geor", "kat"),
  L("el", "Griechisch", "Greek", "ell", "grek", "ell"),
  L("he", "Hebräisch", "Hebrew", "heb", "hebr", "heb"),
  L("hi", "Hindi", "Hindi", "hin", "deva", "hin"),
  L("id", "Indonesisch", "Indonesian", "ind", "latn", "ind"),
  L("ga", "Irisch", "Irish", "gle", "latn", "gle"),
  L("is", "Isländisch", "Icelandic", "isl", "latn", "isl"),
  L("it", "Italienisch", "Italian", "ita", "latn", "ita", "ita"),
  L("ja", "Japanisch", "Japanese", "jpn", "cjk", "jpn"),
  L("ca", "Katalanisch", "Catalan", "cat", "latn", "cat"),
  L("ko", "Koreanisch", "Korean", "kor", "hang"),
  L("hr", "Kroatisch", "Croatian", "hrv", "latn", "hrv"),
  L("lv", "Lettisch", "Latvian", "lvs", "latn", "lav"),
  L("lt", "Litauisch", "Lithuanian", "lit", "latn", "lit"),
  L("mt", "Maltesisch", "Maltese", "mlt", "latn", "mlt"),
  L("mk", "Mazedonisch", "Macedonian", "mkd", "cyrl", "mkd"),
  L("nl", "Niederländisch", "Dutch", "nld", "latn", "nld", "nld"),
  L("no", "Norwegisch", "Norwegian", "nob", "latn", "nob"),
  L("fa", "Persisch", "Persian", "pes", "arab", "pes"),
  L("pl", "Polnisch", "Polish", "pol", "latn", "pol"),
  L("pt", "Portugiesisch", "Portuguese", "por", "latn", "por"),
  L("ro", "Rumänisch", "Romanian", "ron", "latn", "ron"),
  L("ru", "Russisch", "Russian", "rus", "cyrl", "rus"),
  L("sv", "Schwedisch", "Swedish", "swe", "latn", "swe"),
  L("sr", "Serbisch", "Serbian", "srp", "cyrl", "srp_Cyrl"),
  L("sk", "Slowakisch", "Slovak", "slk", "latn"),
  L("sl", "Slowenisch", "Slovenian", "slv", "latn", "slv"),
  L("es", "Spanisch", "Spanish", "spa", "latn", "spa", "spa"),
  L("sw", "Suaheli", "Swahili", "swh", "latn", "swh"),
  L("th", "Thailändisch", "Thai", "tha", "thai", "tha"),
  L("cs", "Tschechisch", "Czech", "ces", "latn", "ces"),
  L("tr", "Türkisch", "Turkish", "tur", "latn", "tur"),
  L("uk", "Ukrainisch", "Ukrainian", "ukr", "cyrl", "ukr"),
  L("hu", "Ungarisch", "Hungarian", "hun", "latn", "hun"),
  L("ur", "Urdu", "Urdu", "urd", "arab", "urd"),
  L("vi", "Vietnamesisch", "Vietnamese", "vie", "latn", "vie"),
  L("cy", "Walisisch", "Welsh", "cym", "latn", "cym"),
];

export const byCode = (code: string) => LANGUAGES.find((l) => l.code === code);

/** Scripts the bundled DejaVu Sans can draw as real (selectable) PDF text. */
export const VECTOR_SCRIPTS = new Set<Script>(["latn", "grek", "cyrl", "armn", "geor"]);

/** Opus-MT models available as Xenova/opus-mt-<id> (ONNX). "jap" is Opus' code for Japanese. */
const OPUS_DIRECT = new Set(
  (
    "af-en ar-en cs-en da-de da-en de-en de-es de-fr en-af en-ar en-cs en-da en-de en-es en-fi en-fr en-hi en-hu " +
    "en-id en-it en-jap en-nl en-ro en-ru en-sv en-uk en-vi en-zh es-de es-en es-fr es-it es-ru et-en fi-de " +
    "fi-en fr-de fr-en fr-es fr-ro fr-ru hi-en hu-en id-en it-en it-es it-fr ja-en ko-en nl-en nl-fr no-de " +
    "pl-en ro-fr ru-en ru-es ru-fr ru-uk sv-en th-en tr-en uk-en uk-ru vi-en zh-en"
  ).split(" "),
);

export interface OpusStep {
  model: string;
  /** target-language token required by the multilingual model, e.g. ">>pol<< " */
  prefix?: string;
}

const opusCode = (code: string) => (code === "ja" ? "jap" : code);

function direct(from: string, to: string): OpusStep | null {
  if (from === "tr" && to === "en") return { model: "Xenova/opus-mt-tc-big-tr-en" };
  if (OPUS_DIRECT.has(`${from}-${to}`)) return { model: `Xenova/opus-mt-${from}-${opusCode(to)}` };
  if (to !== "en" && OPUS_DIRECT.has(`${from}-${opusCode(to)}`)) return { model: `Xenova/opus-mt-${from}-${opusCode(to)}` };
  return null;
}

/** X → English: dedicated model if available, else the multilingual one (understands 300+ languages). */
const toEnglish = (from: string): OpusStep => direct(from, "en") ?? { model: "Xenova/opus-mt-mul-en" };

/** English → Y: dedicated model if available, else the multilingual one with a target token. */
function fromEnglish(to: string): OpusStep | null {
  const d = direct("en", to);
  if (d) return d;
  const mul = byCode(to)?.mul;
  return mul ? { model: "Xenova/opus-mt-en-mul", prefix: `>>${mul}<< ` } : null;
}

/** Model chain for a language pair: direct if available, else via English. null = target not supported. */
export function opusRoute(from: string, to: string): OpusStep[] | null {
  if (from === to) return [];
  const d = direct(from, to);
  if (d) return [d];
  if (from === "en") {
    const b = fromEnglish(to);
    return b ? [b] : null;
  }
  if (to === "en") return [toEnglish(from)];
  const b = fromEnglish(to);
  return b ? [toEnglish(from), b] : null;
}

/** Languages Opus-MT can translate into (from any source). */
export const canOpusTarget = (code: string) => code === "en" || fromEnglish(code) !== null;

/**
 * Detects the document language. franc (trigram statistics, 82 languages) on a large sample; falls back
 * to script detection for very short texts. Returns a code from LANGUAGES or "en" if unsure.
 */
export function detectLanguage(text: string): string {
  const sample = text.replace(/\s+/g, " ").slice(0, 8000);
  const iso3 = franc(sample, { minLength: 10 });
  const hit = LANGUAGES.find((l) => l.franc === iso3 || (iso3 === "arb" && l.code === "ar") || (iso3 === "zlm" && l.code === "id"));
  if (hit) return hit.code;
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const letters = Math.max(1, count(/\p{L}/gu));
  if (count(/\p{Script=Cyrillic}/gu) / letters > 0.3) return /[іїєґ]/i.test(sample) ? "uk" : "ru";
  if (count(/\p{Script=Hangul}/gu) / letters > 0.2) return "ko";
  if (count(/[぀-ヿ]/gu) > 5) return "ja";
  if (count(/\p{Script=Han}/gu) / letters > 0.2) return "zh";
  if (count(/\p{Script=Arabic}/gu) / letters > 0.3) return "ar";
  if (count(/\p{Script=Hebrew}/gu) / letters > 0.3) return "he";
  if (count(/\p{Script=Greek}/gu) / letters > 0.3) return "el";
  if (count(/\p{Script=Thai}/gu) / letters > 0.3) return "th";
  if (count(/\p{Script=Devanagari}/gu) / letters > 0.3) return "hi";
  return "en";
}
