"use client";

import { useRef, useState } from "react";
import { addWatermark, prepareImage, type WatermarkOptions } from "@/lib/pdf/operations";
import { Check, NumberInput, Opt, PageRangeInputs, PositionGrid } from "./controls";
import {
  Done,
  ErrorBanner,
  FileCard,
  IMAGE_ACCEPT,
  Info,
  PDF_ACCEPT,
  Processing,
  Uploader,
  Workspace,
  usePdfFiles,
  useToolRun,
  type ToolTexts,
} from "./shared";

const texts: ToolTexts = {
  title: "Wasserzeichen einfügen",
  subtitle:
    "Versehen Sie Ihr PDF mit einem Text- oder Bild-Wasserzeichen – mit Position, Transparenz und Drehung nach Wahl.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "Optionen",
  actionLabel: "Wasserzeichen hinzufügen",
  processingLabel: "Wasserzeichen wird hinzugefügt...",
  doneTitle: "Das Wasserzeichen wurde hinzugefügt!",
  downloadLabel: "PDF herunterladen",
};

export function WatermarkTool() {
  const { items, add, remove, loading } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [opts, setOpts] = useState<WatermarkOptions>({
    mode: "text",
    text: "VERTRAULICH",
    bold: false,
    italic: false,
    font: "Helvetica",
    fontSize: 48,
    color: "#4f46e5",
    imageScale: 0.3,
    vertical: "middle",
    horizontal: "center",
    mosaic: false,
    opacity: 0.5,
    rotation: 0,
    fromPage: 1,
    toPage: 0,
  });
  const set = (patch: Partial<WatermarkOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const valid = items.filter((it) => !it.error && it.pageCount > 0);
  const single = valid.length === 1;
  const count = single ? valid[0].pageCount : 0;

  // toPage 0 = "until the last page"
  const toPage = opts.toPage || count;

  if (stage === "upload")
    return (
      <Uploader
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onFiles={(files) => {
          add(files);
          setStage("work");
        }}
      />
    );
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done") return <Done texts={texts} files={output} zipName="wasserzeichen.zip" onBack={() => setStage("work")} />;

  const ready = opts.mode === "text" ? opts.text.trim().length > 0 : !!opts.image;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={valid.length > 0 && !loading && ready}
        onProcess={() =>
          run(() =>
            Promise.all(
              valid.map(async (it) => ({
                name: it.file.name.replace(/\.pdf$/i, "") + "_wasserzeichen.pdf",
                bytes: await addWatermark(it.bytes, {
                  ...opts,
                  fromPage: single ? opts.fromPage : 1,
                  toPage: single ? toPage : it.pageCount,
                }),
              })),
            ),
          )
        }
        sidebar={
          <>
            <div className="tl-tabs">
              <button type="button" className="tl-tab" aria-pressed={opts.mode === "text"} onClick={() => set({ mode: "text" })}>
                Text platzieren
              </button>
              <button type="button" className="tl-tab" aria-pressed={opts.mode === "image"} onClick={() => set({ mode: "image" })}>
                Bild platzieren
              </button>
            </div>

            {opts.mode === "text" ? (
              <>
                <Opt title="Text:">
                  <input className="tl-input tl-input--full" value={opts.text} onChange={(e) => set({ text: e.target.value })} aria-label="Text" />
                </Opt>
                <Opt title="Textformat:">
                  <div className="tl-opt__row">
                    <select
                      className="tl-select"
                      style={{ width: "auto", flex: 1 }}
                      value={opts.font}
                      onChange={(e) => set({ font: e.target.value as WatermarkOptions["font"] })}
                      aria-label="Schriftart"
                    >
                      <option value="Helvetica">Arial</option>
                      <option value="Times">Times new roman</option>
                      <option value="Courier">Courier</option>
                    </select>
                    <NumberInput value={opts.fontSize} min={6} max={300} ariaLabel="Schriftgröße" onChange={(fontSize) => set({ fontSize })} />
                    <input
                      type="color"
                      value={opts.color}
                      onChange={(e) => set({ color: e.target.value })}
                      aria-label="Schriftfarbe"
                      style={{ width: 40, height: 40, border: "1px solid #c2c2cc", borderRadius: 8, padding: 2 }}
                    />
                  </div>
                  <div className="tl-opt__row" style={{ marginTop: 8, gap: 16 }}>
                    <Check checked={opts.bold} onChange={(bold) => set({ bold })}>
                      Fett
                    </Check>
                    <Check checked={opts.italic} onChange={(italic) => set({ italic })}>
                      Kursiv
                    </Check>
                  </div>
                </Opt>
              </>
            ) : (
              <Opt>
                <button type="button" className="tl-seg__btn" style={{ width: "100%" }} onClick={() => imageInput.current?.click()}>
                  {opts.image ? "Bild ändern" : "Bild hinzufügen"}
                </button>
                {imageName && <p className="tl-summary" style={{ marginTop: 6 }}>{imageName}</p>}
                <input
                  ref={imageInput}
                  type="file"
                  hidden
                  accept={IMAGE_ACCEPT}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const img = await prepareImage(f);
                    set({ image: { bytes: img.bytes, type: img.type } });
                    setImageName(f.name);
                  }}
                />
                <div className="tl-opt__title" style={{ marginTop: 12 }}>
                  Größe (Anteil der Seitenbreite):
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(opts.imageScale * 100)}
                  onChange={(e) => set({ imageScale: Number(e.target.value) / 100 })}
                  aria-label="Bildgröße"
                  style={{ width: "100%", accentColor: "var(--brand)" }}
                />
              </Opt>
            )}

            <Opt title="Position:">
              <div className="tl-opt__row" style={{ alignItems: "flex-start", gap: 24 }}>
                <PositionGrid
                  vertical={opts.vertical}
                  horizontal={opts.horizontal}
                  disabled={opts.mosaic}
                  onChange={(vertical, horizontal) => set({ vertical, horizontal })}
                />
                <Check checked={opts.mosaic} onChange={(mosaic) => set({ mosaic })}>
                  Mosaik
                </Check>
              </div>
            </Opt>
            <div className="tl-opt__row" style={{ gap: 12 }}>
              <Opt title="Transparenz:">
                <select
                  className="tl-select"
                  value={opts.opacity}
                  onChange={(e) => set({ opacity: Number(e.target.value) })}
                  aria-label="Transparenz"
                >
                  <option value={1}>Keine Transparenz</option>
                  <option value={0.75}>75%</option>
                  <option value={0.5}>50%</option>
                  <option value={0.25}>25%</option>
                </select>
              </Opt>
              <Opt title="Drehung:">
                <select
                  className="tl-select"
                  value={opts.rotation}
                  onChange={(e) => set({ rotation: Number(e.target.value) })}
                  aria-label="Drehung"
                >
                  <option value={0}>Nicht drehen</option>
                  <option value={45}>45 Grade</option>
                  <option value={90}>90 Grade</option>
                  <option value={180}>180 Grade</option>
                  <option value={270}>270 Grade</option>
                </select>
              </Opt>
            </div>
            <Opt title="Seiten:">
              {single ? (
                <PageRangeInputs from={opts.fromPage} to={toPage} max={count} onChange={(fromPage, toPage) => set({ fromPage, toPage })} />
              ) : (
                <Info>
                  <p>Alle Seiten werden mit Wasserzeichen versehen, da mehrere PDFs ausgewählt wurden.</p>
                </Info>
              )}
            </Opt>
          </>
        }
      >
        <div className="tl-files">
          {items.map((it) => (
            <FileCard
              key={it.id}
              name={it.file.name}
              thumb={it.thumb}
              error={it.error}
              subtitle={it.pageCount ? `${it.pageCount} ${it.pageCount === 1 ? "Seite" : "Seiten"}` : undefined}
              onRemove={() => remove(it.id)}
            />
          ))}
        </div>
      </Workspace>
    </>
  );
}
