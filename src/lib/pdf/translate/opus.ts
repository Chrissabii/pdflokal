// In-browser translation with Opus-MT (transformers.js in a Web Worker).
import type { OpusStep } from "./languages";
import type { WorkerJob, WorkerRequest, WorkerResponse } from "./opus.worker";

export interface DownloadProgress {
  model: string;
  loaded: number;
  total: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: string[] | null) => void; reject: (e: Error) => void; onProgress?: (p: DownloadProgress) => void; model: string }
>();
const fileProgress = new Map<number, Map<string, { loaded: number; total: number }>>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./opus.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.type === "progress") {
        const files = fileProgress.get(msg.id) ?? new Map();
        files.set(msg.file, { loaded: msg.loaded, total: msg.total });
        fileProgress.set(msg.id, files);
        let loaded = 0;
        let total = 0;
        files.forEach((f) => {
          loaded += f.loaded;
          total += f.total;
        });
        job.onProgress?.({ model: job.model, loaded, total });
        return;
      }
      pending.delete(msg.id);
      fileProgress.delete(msg.id);
      if (msg.type === "error") job.reject(new Error(msg.message));
      else job.resolve(msg.type === "result" ? msg.texts : null);
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "Übersetzungs-Worker ist abgestürzt");
      pending.forEach((job) => job.reject(err));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Stops all running work (used for "Abbrechen"); the next call starts a fresh worker. */
export function resetOpus() {
  worker?.terminate();
  worker = null;
  const err = new DOMException("Abgebrochen", "AbortError");
  pending.forEach((job) => job.reject(err as unknown as Error));
  pending.clear();
}

function request(msg: WorkerJob, model: string, onProgress?: (p: DownloadProgress) => void) {
  const id = nextId++;
  return new Promise<string[] | null>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, model });
    getWorker().postMessage({ ...msg, id } as WorkerRequest);
  });
}

export const loadModel = (model: string, onProgress?: (p: DownloadProgress) => void) =>
  request({ type: "load", model }, model, onProgress);

/** True if all files of `model` are already in the transformers.js browser cache (usable offline). */
export async function isModelCached(model: string): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");
    const keys = (await cache.keys()).map((r) => r.url);
    return keys.some((u) => u.includes(`/${model}/`) && u.includes("decoder_model_merged_quantized.onnx")) &&
      keys.some((u) => u.includes(`/${model}/`) && u.includes("encoder_model_quantized.onnx"));
  } catch {
    return false;
  }
}

/** Splits a paragraph into sentences; Marian models translate sentence by sentence best. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'»«“”)\]]*|$)\s*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    // keep abbreviations / short fragments attached ("z. B.", "Nr. 5")
    if (out.length && (p.length < 12 || /^[a-zäöüß0-9]/.test(p))) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out.length ? out : [text];
}

/**
 * Output token budget for a batch. Marian models occasionally loop on noisy input (e.g. OCR garbage) and
 * would then generate up to 512 tokens; ~1 token per 3 characters plus generous headroom for longer
 * target languages keeps real sentences intact while cutting such loops short.
 */
export function maxTokensFor(texts: string[]) {
  const longest = Math.max(...texts.map((t) => t.length));
  return Math.min(512, Math.ceil(longest / 3 * 1.6) + 24);
}

export interface OpusOptions {
  route: OpusStep[];
  signal?: AbortSignal;
  onDownload?: (p: DownloadProgress) => void;
  /** called once all models of the route are loaded, right before the first paragraph */
  onReady?: () => void;
}

/**
 * Translates texts through the model route (e.g. it→en→de). `onProgress` reports finished texts.
 * Sentences are sent one at a time: transformers.js keeps decoding already finished sequences of a
 * batch until the longest one ends, which produced junk tails ("......t.,.") and wasted time.
 */
export async function translateWithOpus(
  o: OpusOptions,
  texts: string[],
  onProgress?: (done: number) => void,
): Promise<string[]> {
  if (!o.route.length) return texts;
  const abort = () => resetOpus();
  o.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (const step of o.route) await loadModel(step.model, o.onDownload);
    o.onReady?.();
    const out: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (o.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      let sentences = splitSentences(texts[i]);
      for (const step of o.route) {
        const result: string[] = [];
        for (const sentence of sentences) {
          const input = (step.prefix ?? "") + sentence;
          const res = await request({ type: "translate", model: step.model, texts: [input], maxTokens: maxTokensFor([sentence]) }, step.model);
          result.push(res?.[0]?.trim() || sentence);
        }
        sentences = result;
      }
      out.push(sentences.join(" ").trim() || texts[i]);
      onProgress?.(i + 1);
    }
    return out;
  } finally {
    o.signal?.removeEventListener("abort", abort);
  }
}
