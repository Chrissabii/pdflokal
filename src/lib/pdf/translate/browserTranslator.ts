// Chrome/Edge built-in on-device translation (Translator API). Uses the browser's own translation
// models: fast, good quality, direct language pairs, offline after the language pack was downloaded.
// Not available in every browser (e.g. Firefox, Safari, Android WebView) — callers fall back to Opus-MT.

interface TranslatorInstance {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?: () => void;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

const api = () => (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export type BrowserAvailability = "unavailable" | "downloadable" | "downloading" | "available";

/** "unavailable" when the API is missing, the pair is unsupported, or the browser does not answer. */
export async function browserTranslatorAvailability(from: string, to: string): Promise<BrowserAvailability> {
  const T = api();
  if (!T || from === to) return "unavailable";
  try {
    return await withTimeout(T.availability({ sourceLanguage: from, targetLanguage: to }), 4000, "unavailable" as const);
  } catch {
    return "unavailable";
  }
}

/**
 * Creates the translator. Downloading a language pack needs a user gesture in Chrome, so call this
 * directly from a click when the pair is "downloadable".
 */
export async function createBrowserTranslator(
  from: string,
  to: string,
  onDownload?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<TranslatorInstance> {
  const T = api();
  if (!T) throw new Error("Die Browser-Übersetzung ist hier nicht verfügbar.");
  return T.create({
    sourceLanguage: from,
    targetLanguage: to,
    signal,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onDownload?.((e as unknown as { loaded: number }).loaded));
    },
  });
}

export async function translateWithBrowser(
  translator: TranslatorInstance,
  texts: string[],
  onProgress?: (done: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    out.push((await translator.translate(texts[i], { signal })).trim() || texts[i]);
    onProgress?.(i + 1);
  }
  return out;
}
