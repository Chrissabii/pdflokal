"use client";

import { zipSync } from "fflate";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { OutputFile } from "@/lib/pdf/operations";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf, renderPage } from "@/lib/pdf/pdfjs";

export const PDF_ACCEPT = "application/pdf,.pdf";
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp";

let idCounter = 0;
export const nextId = () => `f${++idCounter}`;

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} MB`;
}

function matchesAccept(file: File, accept: string) {
  const name = file.name.toLowerCase();
  return accept.split(",").some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith(".")) return name.endsWith(r);
    if (r.endsWith("/*")) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}

/* ---------- loaded PDF files with thumbnails ---------- */

export interface PdfItem {
  id: string;
  file: File;
  bytes: ArrayBuffer;
  pageCount: number;
  thumb?: { url: string; width: number; height: number };
  rotation: number;
  error?: string;
}

export function usePdfFiles() {
  const [items, setItems] = useState<PdfItem[]>([]);

  const add = useCallback(async (files: File[]) => {
    const fresh: PdfItem[] = await Promise.all(
      files.map(async (file) => ({ id: nextId(), file, bytes: await file.arrayBuffer(), pageCount: 0, rotation: 0 })),
    );
    setItems((prev) => [...prev, ...fresh]);
    for (const item of fresh) {
      try {
        const doc = await openPdf(item.bytes);
        const thumb = await renderPage(doc, 0, 180);
        const pageCount = doc.numPages;
        await doc.destroy();
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, thumb, pageCount } : it)));
      } catch (err) {
        const message =
          err instanceof Error && err.name === "PasswordException"
            ? "Passwortgeschützt"
            : "Datei konnte nicht gelesen werden";
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, error: message } : it)));
      }
    }
  }, []);

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), []);
  const rotate = useCallback(
    (id: string, delta: number) =>
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, rotation: (it.rotation + delta + 360) % 360 } : it))),
    [],
  );

  // True while any added file is still being read (no page count and no error yet).
  const loading = items.some((it) => !it.error && it.pageCount === 0);

  return { items, setItems, add, remove, rotate, loading };
}

/* ---------- all page thumbnails of one PDF ---------- */

export interface PageThumb {
  url: string;
  width: number;
  height: number;
}

/**
 * Renders page thumbnails of one PDF on demand: the document is opened once, pages are rendered one
 * at a time in request order and cached. Lets the page grids handle documents with thousands of pages
 * (only what scrolls into view is rendered).
 */
export class ThumbSource {
  private doc: Promise<PDFDocumentProxy>;
  private cache = new Map<number, Promise<PageThumb>>();
  private queue: Promise<unknown> = Promise.resolve();
  private destroyed = false;
  readonly pageCount: Promise<number>;

  constructor(bytes: ArrayBuffer, private size = 140) {
    this.doc = openPdf(bytes);
    this.pageCount = this.doc.then((d) => d.numPages);
  }

  get(index: number): Promise<PageThumb> {
    let p = this.cache.get(index);
    if (!p) {
      p = this.queue.then(async () => {
        if (this.destroyed) throw new Error("destroyed");
        return renderPage(await this.doc, index, this.size);
      });
      this.queue = p.catch(() => undefined);
      this.cache.set(index, p);
    }
    return p;
  }

  destroy() {
    this.destroyed = true;
    this.doc.then((d) => d.destroy()).catch(() => undefined);
  }
}

export function useThumbSource(bytes: ArrayBuffer | null, size = 140) {
  const [state, setState] = useState<{ source: ThumbSource | null; pageCount: number; error: string | null }>({
    source: null,
    pageCount: 0,
    error: null,
  });
  useEffect(() => {
    if (!bytes) return;
    const source = new ThumbSource(bytes, size);
    let cancelled = false;
    source.pageCount.then(
      (pageCount) => !cancelled && setState({ source, pageCount, error: null }),
      (err) =>
        !cancelled &&
        setState({
          source: null,
          pageCount: 0,
          error:
            err instanceof Error && err.name === "PasswordException"
              ? "Diese PDF-Datei ist passwortgeschützt."
              : "Die PDF-Datei konnte nicht gelesen werden.",
        }),
    );
    return () => {
      cancelled = true;
      source.destroy();
    };
  }, [bytes, size]);
  return state;
}

/** Thumbnail that renders only once it scrolls into view. */
export function LazyThumb({ source, index, children }: { source: ThumbSource; index: number; children: (thumb?: PageThumb) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<PageThumb>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        source.get(index).then((t) => !cancelled && setThumb(t), () => undefined);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [source, index]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {children(thumb)}
    </div>
  );
}

/* ---------- drag & drop file picking ---------- */

function useFileDrop(accept: string, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return {
    dragging,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        depth.current++;
        setDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => matchesAccept(f, accept));
        if (files.length) onFiles(files);
      },
    },
  };
}

function FileInput({
  accept,
  multiple,
  onFiles,
  inputRef,
}: {
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []).filter((f) => matchesAccept(f, accept));
        e.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
}

/* ---------- stage 1: uploader ---------- */

export interface ToolTexts {
  title: string;
  subtitle: string;
  pickLabel: string;
  dropLabel: string;
  panelTitle: string;
  actionLabel: string;
  processingLabel: string;
  doneTitle: string;
  downloadLabel: string;
}

export function Uploader({
  texts,
  accept,
  multiple,
  onFiles,
}: {
  texts: ToolTexts;
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useFileDrop(accept, (files) => onFiles(multiple ? files : files.slice(0, 1)));
  return (
    <div className={`tl-stage tl-upload${dragging ? " tl-dragging" : ""}`} {...handlers}>
      <div className="tl-header">
        <h1>{texts.title}</h1>
        <h2>{texts.subtitle}</h2>
      </div>
      <div className="tl-uploader">
        <button type="button" className="tl-uploader__btn" onClick={() => inputRef.current?.click()}>
          {texts.pickLabel}
        </button>
        <div className="tl-uploader__drop">{texts.dropLabel}</div>
        <FileInput accept={accept} multiple={multiple} onFiles={onFiles} inputRef={inputRef} />
      </div>
      <p className="tl-local-note">
        <LockIcon /> Ihre Dateien werden ausschließlich lokal in Ihrem Browser verarbeitet und nicht hochgeladen.
      </p>
      {dragging && <div className="tl-dropmask">Dateien hier ablegen</div>}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/* ---------- stage 2: workspace ---------- */

export function Workspace({
  texts,
  accept,
  multiple,
  onAddFiles,
  sidebar,
  canProcess,
  onProcess,
  children,
  workareaClassName,
}: {
  texts: ToolTexts;
  accept: string;
  multiple: boolean;
  onAddFiles?: (files: File[]) => void;
  sidebar: ReactNode;
  canProcess: boolean;
  onProcess: () => void;
  children: ReactNode;
  workareaClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useFileDrop(accept, (files) => onAddFiles?.(files));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className={`tl-stage tl-tool${sidebarOpen ? " tl-tool--toggle" : ""}`}>
      <div className={`tl-workarea${workareaClassName ? ` ${workareaClassName}` : ""}`} {...(onAddFiles ? handlers : {})}>
        {onAddFiles && (
          <div className="tl-addmore">
            <button
              type="button"
              className="tl-addmore__btn"
              title="Weitere Dateien hinzufügen"
              aria-label="Weitere Dateien hinzufügen"
              onClick={() => inputRef.current?.click()}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path d="M9 2v14M2 9h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
            <FileInput accept={accept} multiple={multiple} onFiles={onAddFiles} inputRef={inputRef} />
          </div>
        )}
        {children}
        {dragging && <div className="tl-dropmask">Dateien hier ablegen</div>}
      </div>
      <aside className="tl-sidebar">
        <div className="tl-panel__title">{texts.panelTitle}</div>
        <div className="tl-panel__content">{sidebar}</div>
      </aside>
      <button
        type="button"
        className="tl-sidebar-toggle"
        aria-label="Optionen anzeigen"
        onClick={() => setSidebarOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="tl-process" disabled={!canProcess} onClick={onProcess}>
        {texts.actionLabel}
        <span aria-hidden>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}

export function Info({ children }: { children: ReactNode }) {
  return <div className="tl-info">{children}</div>;
}

/* ---------- file card ---------- */

export function FileCard({
  name,
  thumb,
  rotation = 0,
  subtitle,
  error,
  onRemove,
  onRotate,
  selected,
  dragProps,
  className,
  onClick,
}: {
  name: string;
  thumb?: PageThumb;
  rotation?: number;
  subtitle?: string;
  error?: string;
  onRemove?: () => void;
  onRotate?: () => void;
  selected?: boolean;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  className?: string;
  onClick?: () => void;
}) {
  const { className: dragClass, ...drag } = dragProps ?? {};
  const classes = ["tl-file", selected && "tl-file--selected", className, dragClass].filter(Boolean).join(" ");
  return (
    <div className={classes} onClick={onClick} {...drag}>
      <div className="tl-file__actions">
        {onRotate && (
          <button
            type="button"
            className="tl-file__btn"
            title="Drehen"
            aria-label="Drehen"
            onClick={(e) => {
              e.stopPropagation();
              onRotate();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="tl-file__btn tl-file__btn--remove"
            title="Entfernen"
            aria-label="Entfernen"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="tl-file__canvas">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb.url}
            alt=""
            width={thumb.width}
            height={thumb.height}
            style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
            draggable={false}
          />
        ) : error ? (
          <div className="tl-file__error">{error}</div>
        ) : (
          <div className="tl-file__preload" />
        )}
      </div>
      <div className="tl-file__info" title={name}>
        <span className="tl-file__name">{name}</span>
        {subtitle && <span className="tl-file__sub">{subtitle}</span>}
      </div>
    </div>
  );
}

/* ---------- drag-to-reorder ---------- */

export function useReorder<T>(items: T[], setItems: (next: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const props = (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (overIndex !== index) setOverIndex(index);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragIndex !== index) {
        const next = [...items];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        setItems(next);
      }
      setDragIndex(null);
      setOverIndex(null);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
    className: dragIndex === index ? "tl-file--dragging" : overIndex === index && dragIndex !== null ? "tl-file--over" : undefined,
  });
  return props;
}

/* ---------- stage 3 & 4: processing and download ---------- */

export function Processing({ label }: { label: string }) {
  return (
    <div className="tl-stage tl-processing" role="status" aria-live="polite">
      <div className="tl-spinner" />
      <h2>{label}</h2>
    </div>
  );
}

function toBlob(file: OutputFile) {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a shared/resizable buffer.
  const copy = new Uint8Array(file.bytes.byteLength);
  copy.set(file.bytes);
  return new Blob([copy.buffer], { type: file.type ?? "application/pdf" });
}

export function bundle(files: OutputFile[], zipName: string): { name: string; blob: Blob } {
  if (files.length === 1) return { name: files[0].name, blob: toBlob(files[0]) };
  const used = new Map<string, number>();
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    const n = used.get(f.name) ?? 0;
    used.set(f.name, n + 1);
    entries[n ? f.name.replace(/(\.[^.]+)?$/, `_${n}$1`) : f.name] = f.bytes;
  }
  const zipped = zipSync(entries, { level: 0 });
  return { name: zipName, blob: toBlob({ name: zipName, bytes: zipped, type: "application/zip" }) };
}

function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Done({
  texts,
  files,
  zipName,
  onBack,
}: {
  texts: ToolTexts;
  files: OutputFile[];
  zipName: string;
  onBack: () => void;
}) {
  const [result] = useState(() => bundle(files, zipName));
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    triggerDownload(result.name, result.blob);
  }, [result]);

  return (
    <div className="tl-stage tl-done">
      <h1>{texts.doneTitle}</h1>
      <div className="tl-downloader">
        <button type="button" className="tl-back" onClick={onBack} title="Zurück" aria-label="Zurück">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M19 12H5m0 0 6 6m-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="tl-uploader__btn tl-download" onClick={() => triggerDownload(result.name, result.blob)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 4v11m0 0-5-5m5 5 5-5M5 20h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {files.length > 1 ? `${texts.downloadLabel} (ZIP)` : texts.downloadLabel}
        </button>
      </div>
      <p className="tl-done__meta">
        {result.name} · {formatSize(result.blob.size)}
      </p>
    </div>
  );
}

/* ---------- stage controller ---------- */

export type Stage = "upload" | "work" | "processing" | "done";

export function useToolRun() {
  const [stage, setStage] = useState<Stage>("upload");
  const [output, setOutput] = useState<OutputFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<OutputFile[]>) => {
    setError(null);
    setStage("processing");
    // let the overlay paint before pdf-lib blocks the main thread
    await new Promise((r) => setTimeout(r, 50));
    try {
      const files = await task();
      setOutput(files);
      setStage("done");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setStage("work");
    }
  }, []);

  return { stage, setStage, output, error, setError, run };
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="tl-error" role="alert">
      Bei der Verarbeitung ist ein Fehler aufgetreten: {message}
      <button type="button" onClick={onClose} aria-label="Schließen">
        ×
      </button>
    </div>
  );
}
