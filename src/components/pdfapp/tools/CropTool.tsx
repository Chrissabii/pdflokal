"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cropPdf, type CropRect } from "@/lib/pdf/operations";
import { openPdf, renderPage } from "@/lib/pdf/pdfjs";
import { Opt, Seg } from "./controls";
import { Done, ErrorBanner, Info, PDF_ACCEPT, Processing, Uploader, Workspace, usePdfFiles, useToolRun, type PageThumb, type ToolTexts } from "./shared";

const texts: ToolTexts = {
  title: "PDF zuschneiden",
  subtitle: "Entfernen Sie überflüssige Ränder oder behalten Sie nur einen ausgewählten Bereich der Seite.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "PDF zuschneiden",
  actionLabel: "PDF zuschneiden",
  processingLabel: "PDF wird zugeschnitten...",
  doneTitle: "Die PDF wurde zugeschnitten!",
  downloadLabel: "PDF herunterladen",
};

const FULL: CropRect = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
const MIN = 0.03;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag =
  | { kind: "new"; x0: number; y0: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "resize"; corner: "nw" | "ne" | "sw" | "se" };

export function CropTool() {
  const { items, add } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<PageThumb | null>(null);
  const [rect, setRect] = useState<CropRect>(FULL);
  const [scope, setScope] = useState<"all" | "single">("all");
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const file = items[0];
  const count = file?.pageCount ?? 0;

  useEffect(() => {
    if (!file?.pageCount) return;
    let cancelled = false;
    (async () => {
      const doc = await openPdf(file.bytes);
      const p = await renderPage(doc, page, 640);
      await doc.destroy();
      if (!cancelled) setPreview(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [file, page]);

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
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done") return <Done texts={texts} files={output} zipName="zugeschnitten.zip" onBack={() => setStage("work")} />;

  const point = (e: PointerEvent) => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - box.left) / box.width, 0, 1), y: clamp((e.clientY - box.top) / box.height, 0, 1) };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    stageRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = point(e);
    const target = e.target as HTMLElement;
    const corner = target.dataset.corner as "nw" | "ne" | "sw" | "se" | undefined;
    if (corner) drag.current = { kind: "resize", corner };
    else if (target.dataset.rect) drag.current = { kind: "move", dx: x - rect.left, dy: y - rect.top };
    else {
      drag.current = { kind: "new", x0: x, y0: y };
      setRect({ left: x, top: y, width: 0, height: 0 });
    }
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = point(e);
    if (d.kind === "new") {
      setRect({ left: Math.min(d.x0, x), top: Math.min(d.y0, y), width: Math.abs(x - d.x0), height: Math.abs(y - d.y0) });
    } else if (d.kind === "move") {
      setRect((r) => ({ ...r, left: clamp(x - d.dx, 0, 1 - r.width), top: clamp(y - d.dy, 0, 1 - r.height) }));
    } else {
      setRect((r) => {
        let { left, top } = r;
        let right = r.left + r.width;
        let bottom = r.top + r.height;
        if (d.corner.includes("w")) left = clamp(x, 0, right - MIN);
        if (d.corner.includes("e")) right = clamp(x, left + MIN, 1);
        if (d.corner.includes("n")) top = clamp(y, 0, bottom - MIN);
        if (d.corner.includes("s")) bottom = clamp(y, top + MIN, 1);
        return { left, top, width: right - left, height: bottom - top };
      });
    }
  };

  const onUp = () => {
    if (drag.current?.kind === "new" && (rect.width < MIN || rect.height < MIN)) setRect(FULL);
    drag.current = null;
  };

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const valid = rect.width >= MIN && rect.height >= MIN;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple={false}
        canProcess={count > 0 && valid}
        onProcess={() =>
          run(async () => [
            {
              name: file.file.name.replace(/\.pdf$/i, "") + "_zugeschnitten.pdf",
              bytes: await cropPdf(file.bytes, rect, scope === "all" ? "all" : [page]),
            },
          ])
        }
        sidebar={
          <>
            <Info>
              <p>Ziehen Sie mit der Maus (oder dem Finger) einen Rahmen um den Bereich, der erhalten bleiben soll. Ecken und Rahmen lassen sich verschieben.</p>
            </Info>
            <button type="button" className="tl-link-btn" onClick={() => setRect(FULL)}>
              ↺ Alle zurücksetzen
            </button>
            <Opt title="Seiten:">
              <Seg
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: "Alle Seiten" },
                  { value: "single", label: "Aktuelle Seite" },
                ]}
              />
            </Opt>
            <div className="tl-summary">
              Auswahl: {Math.round(rect.width * 100)} % × {Math.round(rect.height * 100)} % der Seite
            </div>
          </>
        }
      >
        <div className="tl-crop">
          {preview ? (
            <div
              ref={stageRef}
              className="tl-crop__stage"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={`Seite ${page + 1}`} draggable={false} />
              <div
                className="tl-crop__rect"
                data-rect="1"
                style={{ left: pct(rect.left), top: pct(rect.top), width: pct(rect.width), height: pct(rect.height) }}
              >
                {(["nw", "ne", "sw", "se"] as const).map((c) => (
                  <span
                    key={c}
                    data-corner={c}
                    className="tl-crop__handle"
                    style={{
                      left: c.includes("w") ? -8 : undefined,
                      right: c.includes("e") ? -8 : undefined,
                      top: c.includes("n") ? -8 : undefined,
                      bottom: c.includes("s") ? -8 : undefined,
                      cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="tl-file__preload" style={{ width: 300, height: 400 }} />
          )}
          {count > 1 && (
            <div className="tl-crop__nav">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Vorherige Seite">
                ‹
              </button>
              Seite {page + 1} von {count}
              <button type="button" disabled={page >= count - 1} onClick={() => setPage(page + 1)} aria-label="Nächste Seite">
                ›
              </button>
            </div>
          )}
        </div>
      </Workspace>
    </>
  );
}
