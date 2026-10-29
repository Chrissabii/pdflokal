// Minimal client for a local Ollama server (https://ollama.com). Runs from the browser:
// Ollama allows http://localhost:* origins by default, so no backend is needed and nothing leaves the machine.

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface OllamaModel {
  name: string;
  size: number;
}

const trimUrl = (url: string) => url.replace(/\/+$/, "");

export async function listModels(baseUrl: string, signal?: AbortSignal): Promise<OllamaModel[]> {
  const res = await fetch(`${trimUrl(baseUrl)}/api/tags`, { signal });
  if (!res.ok) throw new Error(`Ollama antwortet mit ${res.status}`);
  const data = (await res.json()) as { models?: { name: string; size: number }[] };
  return (data.models ?? []).map((m) => ({ name: m.name, size: m.size }));
}

export interface TranslateOptions {
  baseUrl: string;
  model: string;
  /** English language name, or "auto" */
  source: string;
  /** English language name */
  target: string;
  signal?: AbortSignal;
}

const SCHEMA = {
  type: "object",
  properties: { translations: { type: "array", items: { type: "string" } } },
  required: ["translations"],
};

function systemPrompt(o: TranslateOptions, count: number) {
  const from = o.source === "auto" ? "the source language (detect it)" : o.source;
  return [
    `You are a professional document translator. Translate each string of the JSON array from ${from} into ${o.target}.`,
    "Keep numbers, dates, names, product names, URLs, e-mail addresses and code unchanged.",
    "Keep the meaning and the tone; do not summarize, do not add explanations or notes.",
    "If a string is already in the target language or cannot be translated, return it unchanged.",
    `Return JSON of the form {"translations": [...]} with exactly ${count} strings in the same order.`,
  ].join(" ");
}

async function chat(o: TranslateOptions, texts: string[]): Promise<string[] | null> {
  const res = await fetch(`${trimUrl(o.baseUrl)}/api/chat`, {
    method: "POST",
    signal: o.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: o.model,
      stream: false,
      format: SCHEMA,
      keep_alive: "15m",
      options: { temperature: 0.1, num_ctx: 4096 },
      messages: [
        { role: "system", content: systemPrompt(o, texts.length) },
        { role: "user", content: JSON.stringify(texts) },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama-Fehler ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  try {
    const parsed = JSON.parse(data.message?.content ?? "") as { translations?: unknown };
    const list = parsed.translations;
    if (Array.isArray(list) && list.length === texts.length && list.every((t) => typeof t === "string")) {
      return list as string[];
    }
  } catch {
    // fall through to the per-item fallback
  }
  return null;
}

/** Splits texts into batches of roughly `maxChars` characters (small models lose track on long inputs). */
export function batchTexts(texts: string[], maxChars = 1200): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let size = 0;
  texts.forEach((t, i) => {
    if (current.length && size + t.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += t.length;
  });
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Translates `texts` batch by batch. If the model returns a malformed batch, each item of that
 * batch is translated on its own. `onProgress` reports the number of finished texts.
 */
export async function translateTexts(
  o: TranslateOptions,
  texts: string[],
  onProgress?: (done: number) => void,
): Promise<string[]> {
  const out = [...texts];
  let done = 0;
  for (const batch of batchTexts(texts)) {
    const input = batch.map((i) => texts[i]);
    const translated = await chat(o, input);
    if (translated) {
      batch.forEach((i, k) => (out[i] = translated[k].trim() || texts[i]));
      done += batch.length;
      onProgress?.(done);
      continue;
    }
    for (const i of batch) {
      const single = await chat(o, [texts[i]]);
      out[i] = single?.[0]?.trim() || texts[i];
      onProgress?.(++done);
    }
  }
  return out;
}
