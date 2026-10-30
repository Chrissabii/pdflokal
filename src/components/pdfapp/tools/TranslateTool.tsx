"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base";
import { openPdf } from "@/lib/pdf/pdfjs";
import {
  browserTranslatorAvailability,
  createBrowserTranslator,
  translateWithBrowser,
  type BrowserAvailability,
} from "@/lib/pdf/translate/browserTranslator";
import { extractPages, type OcrMode, type PageText } from "@/lib/pdf/translate/extract";
import { LANGUAGES, VECTOR_SCRIPTS, byCode, canOpusTarget, detectLanguage, opusRoute, type OpusStep } from "@/lib/pdf/translate/languages";
import { DEFAULT_OLLAMA_URL, listModels, translateTexts, type OllamaModel } from "@/lib/pdf/translate/ollama";
import { isModelCached, loadModel, translateWithOpus, type DownloadProgress } from "@/lib/pdf/translate/opus";
import { assemble, parseGlossary, planTranslation } from "@/lib/pdf/translate/prepare";
import { createRasterizer } from "@/lib/pdf/translate/raster";
import { writeTranslatedPdf, type TranslateOutputMode } from "@/lib/pdf/translate/write";
import { Opt, PageGrid, PageRangeInputs, Seg } from "./controls";
import { Done, ErrorBanner, Info, PDF_ACCEPT, Uploader, Workspace, formatSize, usePdfFiles, useToolRun, type ToolTexts } from "./shared";

const texts: ToolTexts = {
  title: "PDF übersetzen",
  subtitle:
    "Übersetzen Sie ganze Dokumente und behalten Sie dabei das Layout – auch eingescannte Seiten. Alles läuft auf Ihrem Gerät, auf Wunsch komplett offline.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "PDF übersetzen",
  actionLabel: "PDF übersetzen",
  processingLabel: "PDF wird übersetzt...",
  doneTitle: "Die PDF wurde übersetzt!",
  downloadLabel: "Übersetzte PDF herunterladen",
};

/** auto = the browser's built-in translator (Chrome/Edge) when it supports the pair, else Opus-MT */
type Engine = "auto" | "opus" | "ollama";

interface Settings {
  engine: Engine;
  baseUrl: string;
  ollamaModel: string;
  source: string; // language code or "auto"
  target: string; // language code
  mode: TranslateOutputMode;
  ocr: OcrMode;
  /** user glossary, one "term = translation" per line */
  glossary: string;
}

const DEFAULTS: Settings = {
  engine: "auto",
  baseUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: "",
  source: "auto",
  target: "de",
  mode: "layout",
  ocr: "auto",
  glossary: "",
};
const STORAGE_KEY = "pdflokal-translate-settings";
const RECOMMENDED_OLLAMA_MODEL = "qwen2.5:3b";
const RTL = new Set(["ar", "he", "fa", "ur"]);

function loadSettings(): Settings {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") } as Settings;
    if (!byCode(saved.target)) saved.target = DEFAULTS.target;
    if (saved.source !== "auto" && !byCode(saved.source)) saved.source = "auto";
    if (!["auto", "opus", "ollama"].includes(saved.engine)) saved.engine = "auto";
    return saved;
  } catch {
    return DEFAULTS;
  }
}

type OllamaStatus = { state: "checking" } | { state: "ok"; models: OllamaModel[] } | { state: "offline" };

interface Progress {
  phase: "extract" | "download" | "translate" | "write";
  done: number;
  total: number;
  startedAt: number;
  detail?: string;
}

const stepKey = (route: OpusStep[] | null) => route?.map((s) => s.model).join("|") ?? "";

export function TranslateTool() {
  const { items, add } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const [settings, setSettings] = useState<Settings>(() => (typeof window === "undefined" ? DEFAULTS : loadSettings()));
  const [ollama, setOllama] = useState<OllamaStatus>({ state: "checking" });
  const [browser, setBrowser] = useState<BrowserAvailability>("unavailable");
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [download, setDownload] = useState<DownloadProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const file = items[0];
  const count = file?.pageCount ?? 0;
  const from = range?.from ?? 1;
  const to = range?.to ?? count;

  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable (private mode) — settings just won't persist
      }
      return next;
    });

  const checkOllama = useCallback(async (baseUrl: string) => {
    setOllama({ state: "checking" });
    try {
      setOllama({ state: "ok", models: await listModels(baseUrl, AbortSignal.timeout(4000)) });
    } catch {
      setOllama({ state: "offline" });
    }
  }, []);

  useEffect(() => {
    if (stage !== "work" || settings.engine !== "ollama") return;
    const id = setTimeout(() => checkOllama(settings.baseUrl), 0);
    return () => clearTimeout(id);
  }, [stage, settings.engine, settings.baseUrl, checkOllama]);

  // Built-in browser translator (Chrome/Edge): can it do the chosen pair?
  useEffect(() => {
    if (stage !== "work" || settings.engine !== "auto" || settings.source === "auto") return;
    let cancelled = false;
    browserTranslatorAvailability(settings.source, settings.target).then((a) => !cancelled && setBrowser(a));
    return () => {
      cancelled = true;
    };
  }, [stage, settings.engine, settings.source, settings.target]);

  const route = settings.source === "auto" ? null : opusRoute(settings.source, settings.target);
  const routeKey = stepKey(route);

  const refreshCached = useCallback(async (models: string[]) => {
    const entries = await Promise.all(models.map(async (m) => [m, await isModelCached(m)] as const));
    setCached((c) => ({ ...c, ...Object.fromEntries(entries) }));
  }, []);

  useEffect(() => {
    if (stage !== "work" || settings.engine === "ollama" || !routeKey) return;
    const id = setTimeout(() => refreshCached(routeKey.split("|")), 0);
    return () => clearTimeout(id);
  }, [stage, settings.engine, routeKey, refreshCached]);

  const ollamaModels = ollama.state === "ok" ? ollama.models : [];
  const ollamaModel = ollamaModels.some((m) => m.name === settings.ollamaModel)
    ? settings.ollamaModel
    : (ollamaModels[0]?.name ?? "");

  if (stage === "upload")
    return (
      <Uploader
        texts={texts}
        accept={PDF_ACCEPT}
        multiple={false}
        onFiles={(files) => {
          add(files.slice(0, 1));
          setStage("work");
        }}
      />
    );
  if (stage === "processing") return <TranslateProgress progress={progress} onCancel={() => abort.current?.abort()} />;
  if (stage === "done") {
    const name = `${file.file.name.replace(/\.pdf$/i, "")}_übersetzt.pdf`;
    return <Done texts={texts} files={output} zipName={name} onBack={() => setStage("work")} />;
  }

  const browserUsable = settings.engine === "auto" && settings.source !== "auto" && browser !== "unavailable";
  const opusOk = settings.source === "auto" ? canOpusTarget(settings.target) || settings.engine === "auto" : route !== null;
  const engineReady = settings.engine === "ollama" ? ollama.state === "ok" && !!ollamaModel : browserUsable || opusOk;
  const pagesToTranslate = Math.max(0, to - from + 1);

  const downloadModels = async (steps: OpusStep[]) => {
    const models = steps.map((s) => s.model);
    try {
      for (const m of models) await loadModel(m, setDownload);
    } catch (err) {
      setError(`Download fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}. Für den ersten Download wird Internet benötigt.`);
    } finally {
      // transformers.js writes the browser cache shortly after loading, so check a few times
      for (let i = 0; i < 10; i++) {
        if ((await Promise.all(models.map(isModelCached))).every(Boolean)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await refreshCached(models);
      setDownload(null);
    }
  };

  const translate = () => {
    const controller = new AbortController();
    abort.current = controller;
    // Downloading a browser language pack needs a user gesture, so it starts right in the click handler.
    const browserTranslator = browserUsable
      ? createBrowserTranslator(settings.source, settings.target, undefined, controller.signal).catch(() => null)
      : null;

    run(async () => {
      try {
        const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
        const sourceOcr = settings.source !== "auto" ? byCode(settings.source)?.ocr : undefined;
        setProgress({ phase: "extract", done: 0, total: indices.length, startedAt: Date.now() });
        const doc = await openPdf(file.bytes);
        let pages: PageText[];
        let documentSample = "";
        try {
          pages = await extractPages(doc, indices, {
            ocr: settings.ocr,
            ocrLangs: sourceOcr ? [sourceOcr] : settings.source === "auto" ? "auto" : ["eng"],
            detect: (t) => byCode(detectLanguage(t))?.ocr,
            onSampleText: (t) => (documentSample = t),
            onPage: (done) => setProgress((p) => (p ? { ...p, done, detail: undefined } : p)),
            onOcr: (page, pr) =>
              setProgress((p) => (p ? { ...p, detail: `Texterkennung (OCR) Seite ${page + 1}: ${Math.round(pr * 100)} %` } : p)),
          });
        } finally {
          await doc.destroy();
        }
        if (controller.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        const blockTexts = pages.flatMap((p) => p.blocks.map((b) => b.text));
        if (blockTexts.join("").trim().length < 3) {
          throw new Error(
            settings.ocr === "off"
              ? "In diesem PDF wurde kein auswählbarer Text gefunden. Aktivieren Sie die Texterkennung (OCR) für eingescannte Dokumente."
              : "Auch mit Texterkennung (OCR) wurde kein lesbarer Text gefunden.",
          );
        }

        const source = settings.source === "auto" ? detectLanguage(`${blockTexts.join(" ")} ${documentSample}`) : settings.source;
        const target = settings.target;
        const sourceLabel = byCode(source)?.label ?? source;
        const targetLabel = byCode(target)?.label ?? target;
        if (source === target) throw new Error(`Das Dokument ist bereits auf ${targetLabel}.`);

        const plan = planTranslation(blockTexts, parseGlossary(settings.glossary));
        const onTranslated = (done: number) => setProgress((p) => (p ? { ...p, done } : p));
        let translatedQueue: string[] | null = null;

        // 1) built-in browser translation (Chrome/Edge), if it supports the pair
        if (settings.engine === "auto") {
          let translator = browserTranslator ? await browserTranslator : null;
          if (!translator && settings.source === "auto" && (await browserTranslatorAvailability(source, target)) === "available") {
            translator = await createBrowserTranslator(source, target, undefined, controller.signal).catch(() => null);
          }
          if (translator) {
            setProgress({ phase: "translate", done: 0, total: plan.queue.length, startedAt: Date.now() });
            translatedQueue = await translateWithBrowser(translator, plan.queue, onTranslated, controller.signal);
          }
        }

        // 2) Opus-MT in the browser (offline after the one-time model download)
        if (!translatedQueue && settings.engine !== "ollama") {
          const r = opusRoute(source, target);
          if (!r) {
            throw new Error(
              `Für ${sourceLabel} → ${targetLabel} gibt es kein Offline-Übersetzungsmodell. In Chrome oder Edge am PC steht dafür die eingebaute Übersetzung zur Verfügung.`,
            );
          }
          const offline = (await Promise.all(r.map((s) => isModelCached(s.model)))).every(Boolean);
          setProgress({ phase: "download", done: 0, total: 0, startedAt: Date.now(), detail: "Übersetzungsmodell wird geladen …" });
          translatedQueue = await translateWithOpus(
            {
              route: r,
              signal: controller.signal,
              onDownload: (d) =>
                setProgress({
                  phase: "download",
                  done: d.loaded,
                  total: d.total,
                  startedAt: Date.now(),
                  detail: offline
                    ? "Übersetzungsmodell wird aus dem Offline-Speicher geladen …"
                    : `Modell ${d.model.replace("Xenova/", "")} wird heruntergeladen (einmalig): ${formatSize(d.loaded)} von ${formatSize(d.total)}`,
                }),
              onReady: () => setProgress({ phase: "translate", done: 0, total: plan.queue.length, startedAt: Date.now() }),
            },
            plan.queue,
            onTranslated,
          );
        }

        // 3) Ollama (local LLM server)
        if (!translatedQueue) {
          setProgress({ phase: "translate", done: 0, total: plan.queue.length, startedAt: Date.now() });
          translatedQueue = await translateTexts(
            {
              baseUrl: settings.baseUrl,
              model: ollamaModel,
              source: byCode(source)?.name ?? "auto",
              target: byCode(target)?.name ?? "German",
              signal: controller.signal,
            },
            plan.queue,
            onTranslated,
          );
        }

        setProgress({ phase: "write", done: 0, total: 1, startedAt: Date.now() });
        const translatedBlocks = assemble(plan, translatedQueue);
        let k = 0;
        const perPage = pages.map((p) => p.blocks.map(() => translatedBlocks[k++]));
        const [regular, bold, serif, serifBold] = await Promise.all(
          ["/fonts/DejaVuSans.ttf", "/fonts/DejaVuSans-Bold.ttf", "/fonts/DejaVuSerif.ttf", "/fonts/DejaVuSerif-Bold.ttf"].map((u) =>
            fetch(withBase(u)).then((r) => r.arrayBuffer()),
          ),
        );
        const script = byCode(target)?.script ?? "latn";
        const rasterize = VECTOR_SCRIPTS.has(script) ? undefined : createRasterizer(RTL.has(target));
        const bytes = await writeTranslatedPdf(file.bytes, pages, perPage, settings.mode, { regular, bold, serif, serifBold }, { rasterize });
        const suffix = settings.mode === "text" ? "_übersetzt_text" : "_übersetzt";
        return [{ name: `${file.file.name.replace(/\.pdf$/i, "")}${suffix}.pdf`, bytes }];
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          throw new Error("Die Übersetzung wurde abgebrochen.");
        }
        if (settings.engine === "ollama" && err instanceof TypeError && /fetch|network/i.test(err.message)) {
          throw new Error(`Ollama ist nicht erreichbar (${settings.baseUrl}). Läuft Ollama noch?`);
        }
        throw err;
      }
    });
  };

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple={false}
        canProcess={count > 0 && engineReady && pagesToTranslate > 0 && !download}
        onProcess={translate}
        sidebar={
          <>
            <Info>
              <p>
                Die Sprache des Dokuments wird automatisch erkannt. Wählen Sie sie selbst aus, um das Übersetzungsmodell vorab für die
                Offline-Nutzung zu laden.
              </p>
            </Info>
            <Opt title="Von:">
              <select className="tl-select" value={settings.source} onChange={(e) => update({ source: e.target.value })} aria-label="Ausgangssprache">
                <option value="auto">Automatisch erkennen</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Opt>
            <Opt title="Nach:">
              <select className="tl-select" value={settings.target} onChange={(e) => update({ target: e.target.value })} aria-label="Zielsprache">
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              {!VECTOR_SCRIPTS.has(byCode(settings.target)?.script ?? "latn") && (
                <p className="tl-summary" style={{ marginTop: 6 }}>
                  Diese Schrift wird mit den Schriftarten Ihres Geräts als Bild in die PDF gesetzt (sieht richtig aus, ist aber nicht
                  als Text markierbar).
                </p>
              )}
            </Opt>
            <Opt title="Seiten:">
              {count > 0 ? (
                <PageRangeInputs from={from} to={to} max={count} onChange={(f, t) => setRange({ from: f, to: t })} />
              ) : (
                <span className="tl-summary">Wird geladen …</span>
              )}
            </Opt>
            <Opt title="Ergebnis:">
              <Seg
                value={settings.mode}
                onChange={(mode) => update({ mode })}
                options={[
                  { value: "layout", label: "Layout beibehalten" },
                  { value: "text", label: "Nur Text" },
                ]}
              />
            </Opt>
            <Opt title="Texterkennung (OCR) für Scans und Bilder:">
              <Seg
                value={settings.ocr}
                onChange={(ocr) => update({ ocr })}
                options={[
                  { value: "auto", label: "Automatisch" },
                  { value: "always", label: "Immer" },
                  { value: "off", label: "Aus" },
                ]}
              />
              <p className="tl-summary" style={{ marginTop: 6 }}>
                Automatisch erkennt eingescannte Dokumente selbst und liest auch Schrift in Fotos und Grafiken. Offline-Texterkennung für Deutsch, Englisch, Französisch, Spanisch,
                Italienisch und Niederländisch.
              </p>
            </Opt>
            <Opt title="Fachbegriffe (optional):">
              <textarea
                className="tl-input tl-input--full"
                style={{ height: 76, padding: 8, resize: "vertical" }}
                placeholder={"pasta frolla = Mürbeteig\nplanetaria = Küchenmaschine"}
                value={settings.glossary}
                onChange={(e) => update({ glossary: e.target.value })}
                aria-label="Fachbegriffe"
              />
              <p className="tl-summary" style={{ marginTop: 6 }}>
                Ein Begriff pro Zeile: Original = gewünschte Übersetzung. Hilft bei Fachwörtern, die sonst falsch übersetzt werden.
              </p>
            </Opt>
            <Opt title="Übersetzung:">
              <Seg
                value={settings.engine}
                onChange={(engine) => update({ engine })}
                options={[
                  { value: "auto", label: "Automatisch" },
                  { value: "opus", label: "Opus-MT" },
                  { value: "ollama", label: "Ollama" },
                ]}
              />
            </Opt>
            {settings.engine === "ollama" ? (
              <OllamaPanel
                status={ollama}
                model={ollamaModel}
                onModel={(m) => update({ ollamaModel: m })}
                baseUrl={settings.baseUrl}
                onBaseUrl={(baseUrl) => update({ baseUrl })}
                onRetry={() => checkOllama(settings.baseUrl)}
              />
            ) : (
              <>
                {browserUsable && (
                  <div className="tl-ollama" style={{ marginBottom: 12 }}>
                    <div className="tl-ollama__status tl-ollama__status--ok">
                      {browser === "available"
                        ? "Eingebaute Browser-Übersetzung wird genutzt (schnell, offline)"
                        : "Eingebaute Browser-Übersetzung: Sprachpaket wird beim Start einmalig geladen"}
                    </div>
                  </div>
                )}
                {!(browserUsable && browser === "available") && (
                  <OpusPanel
                    route={route}
                    auto={settings.source === "auto"}
                    cached={cached}
                    download={download}
                    onDownload={() => route && downloadModels(route)}
                  />
                )}
              </>
            )}
          </>
        }
      >
        {file && <PageGrid bytes={file.bytes} pageClass={(i) => (i + 1 >= from && i + 1 <= to ? undefined : "tl-file--muted")} />}
      </Workspace>
    </>
  );
}

function OpusPanel({
  route,
  auto,
  cached,
  download,
  onDownload,
}: {
  route: OpusStep[] | null;
  auto: boolean;
  cached: Record<string, boolean>;
  download: DownloadProgress | null;
  onDownload: () => void;
}) {
  if (auto) {
    return (
      <p className="tl-summary">
        Die Sprache wird automatisch erkannt. Fehlt das passende Modell, wird es beim ersten Übersetzen einmalig heruntergeladen
        (ca. 100 MB je Sprachrichtung) und danach offline genutzt. Für einen Download vorab wählen Sie die Ausgangssprache aus.
      </p>
    );
  }
  if (!route) {
    return (
      <div className="tl-ollama__help">
        Für dieses Sprachpaar gibt es kein Offline-Modell. Wählen Sie eine andere Zielsprache oder nutzen Sie Ollama.
      </div>
    );
  }
  if (!route.length) return <p className="tl-summary">Ausgangs- und Zielsprache sind gleich.</p>;
  const allCached = route.every((s) => cached[s.model]);
  return (
    <div className="tl-ollama">
      <div className={`tl-ollama__status tl-ollama__status--${allCached ? "ok" : "checking"}`}>
        {allCached ? "Offline verfügbar" : "Modell noch nicht heruntergeladen"}
      </div>
      <p className="tl-summary">
        {route.length > 1 ? "Übersetzung über Englisch: " : "Modell: "}
        {route.map((s) => s.model.replace("Xenova/opus-mt-", "")).join(" → ")}
      </p>
      {!allCached &&
        (download ? (
          <div>
            <div className="tl-progress" style={{ width: "100%" }}>
              <div
                className="tl-progress__bar"
                style={{ width: `${download.total ? Math.round((download.loaded / download.total) * 100) : 5}%` }}
              />
            </div>
            <p className="tl-summary" style={{ marginTop: 6 }}>
              {formatSize(download.loaded)} von {download.total ? formatSize(download.total) : "…"}
            </p>
          </div>
        ) : (
          <>
            <button type="button" className="tl-seg__btn" style={{ flex: "none" }} onClick={onDownload}>
              Für Offline-Nutzung herunterladen
            </button>
            <p className="tl-summary">Einmalig ca. 100 MB je Sprachrichtung. Danach funktioniert die Übersetzung ohne Internet.</p>
          </>
        ))}
    </div>
  );
}

function OllamaPanel({
  status,
  model,
  onModel,
  baseUrl,
  onBaseUrl,
  onRetry,
}: {
  status: OllamaStatus;
  model: string;
  onModel: (m: string) => void;
  baseUrl: string;
  onBaseUrl: (url: string) => void;
  onRetry: () => void;
}) {
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  return (
    <div className="tl-ollama">
      <div className={`tl-ollama__status tl-ollama__status--${status.state}`}>
        {status.state === "checking" && "Verbindung zu Ollama wird geprüft …"}
        {status.state === "ok" && (status.models.length ? "Ollama ist verbunden" : "Ollama läuft, aber es ist kein Modell installiert")}
        {status.state === "offline" && "Ollama ist nicht erreichbar"}
      </div>
      {status.state === "ok" && status.models.length > 0 && (
        <select className="tl-select" value={model} onChange={(e) => onModel(e.target.value)} aria-label="KI-Modell">
          {status.models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({formatSize(m.size)})
            </option>
          ))}
        </select>
      )}
      {(status.state === "offline" || (status.state === "ok" && status.models.length === 0)) && (
        <div className="tl-ollama__help">
          {status.state === "offline" ? (
            <p>
              Installieren und starten Sie <strong>Ollama</strong> (ollama.com). Laden Sie danach einmalig ein Modell, z. B.:
            </p>
          ) : (
            <p>Laden Sie einmalig ein Modell, z. B. im Terminal:</p>
          )}
          <code>ollama pull {RECOMMENDED_OLLAMA_MODEL}</code>
          <button type="button" className="tl-link-btn" onClick={onRetry}>
            ↻ Erneut prüfen
          </button>
        </div>
      )}
      <details className="tl-ollama__advanced">
        <summary>Ollama-Adresse</summary>
        <div className="tl-opt__row" style={{ marginTop: 8 }}>
          <input className="tl-input" style={{ flex: 1 }} value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} aria-label="Ollama-Adresse" />
          <button type="button" className="tl-seg__btn" style={{ flex: "none" }} onClick={() => onBaseUrl(urlDraft.trim() || DEFAULT_OLLAMA_URL)}>
            Übernehmen
          </button>
        </div>
      </details>
    </div>
  );
}

function TranslateProgress({ progress, onCancel }: { progress: Progress | null; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = progress;
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  let detail = p?.detail ?? "Vorbereitung …";
  if (p?.phase === "extract" && !p.detail) detail = `Text wird erkannt: Seite ${Math.min(p.done + 1, p.total)} von ${p.total} …`;
  if (p?.phase === "translate") {
    detail = `Abschnitt ${Math.min(p.done + 1, p.total)} von ${p.total} wird übersetzt …`;
    if (p.done > 0) {
      const rest = Math.round((((now - p.startedAt) / p.done) * (p.total - p.done)) / 1000);
      detail += ` · noch ca. ${rest >= 60 ? `${Math.round(rest / 60)} Min.` : `${rest} Sek.`}`;
    }
  }
  if (p?.phase === "write") detail = "Übersetzte PDF wird erstellt …";
  const bar = p?.phase === "write" ? 100 : p?.total ? pct : 3;
  return (
    <div className="tl-stage tl-processing" role="status" aria-live="polite">
      <div className="tl-spinner" />
      <h2>{texts.processingLabel}</h2>
      <div className="tl-progress" aria-label={`${bar} %`}>
        <div className="tl-progress__bar" style={{ width: `${bar}%` }} />
      </div>
      <p className="tl-summary">{detail}</p>
      <button type="button" className="tl-seg__btn" style={{ flex: "none", padding: "10px 24px" }} onClick={onCancel}>
        Abbrechen
      </button>
    </div>
  );
}
