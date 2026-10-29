/// <reference lib="webworker" />
// Runs Opus-MT translation models with transformers.js off the main thread.
// Models are downloaded once from huggingface.co and then served from the browser cache (offline).
import { env, pipeline } from "@huggingface/transformers";
import { withBase } from "@/lib/base";

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX Runtime WASM files are served locally (copied by scripts/copy-vendor-assets.mjs).
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = withBase("/ort/");
  // Multi-threaded WASM needs SharedArrayBuffer, i.e. a cross-origin isolated page (COOP/COEP headers,
  // added by the service worker). Otherwise ONNX Runtime falls back to a single thread.
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
}

export type WorkerJob =
  | { type: "load"; model: string }
  | { type: "translate"; model: string; texts: string[]; maxTokens: number };
export type WorkerRequest = WorkerJob & { id: number };

// transformers.js' own overloads are too complex for TypeScript here; this is the part we use.
type Translator = (texts: string[], options: { max_new_tokens: number }) => Promise<{ translation_text: string }[]>;
type LoadPipeline = (
  task: "translation",
  model: string,
  options: {
    dtype: "q8";
    device: "wasm";
    progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => void;
  },
) => Promise<Translator>;

export type WorkerResponse =
  | { type: "progress"; id: number; file: string; loaded: number; total: number }
  | { type: "loaded"; id: number }
  | { type: "result"; id: number; texts: string[] }
  | { type: "error"; id: number; message: string };

const pipes = new Map<string, Promise<Translator>>();

function load(model: string, id: number) {
  let p = pipes.get(model);
  if (!p) {
    p = (pipeline as unknown as LoadPipeline)("translation", model, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (info) => {
        if (info.status === "progress" && info.file) {
          post({ type: "progress", id, file: info.file, loaded: info.loaded ?? 0, total: info.total ?? 0 });
        }
      },
    });
    p.catch(() => pipes.delete(model));
    pipes.set(model, p);
  }
  return p;
}

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const translator = await load(msg.model, msg.id);
    if (msg.type === "load") {
      post({ type: "loaded", id: msg.id });
      return;
    }
    const output = await translator(msg.texts, { max_new_tokens: msg.maxTokens });
    post({ type: "result", id: msg.id, texts: output.map((o) => o.translation_text) });
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
