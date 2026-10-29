"use client";

import { useState } from "react";
import { addPageNumbers, type PageNumberOptions } from "@/lib/pdf/operations";
import { Check, NumberInput, Opt, PageRangeInputs, PositionGrid, Seg } from "./controls";
import { Done, ErrorBanner, FileCard, Info, PDF_ACCEPT, Processing, Uploader, Workspace, usePdfFiles, useToolRun, type ToolTexts } from "./shared";

const texts: ToolTexts = {
  title: "Seitenzahlen einfügen",
  subtitle:
    "Nummerieren Sie die Seiten Ihres Dokuments – mit Position, Startzahl, Text und Schriftgröße nach Wahl.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "Optionen",
  actionLabel: "Seitenzahlen hinzufügen",
  processingLabel: "Seitenzahlen werden hinzugefügt...",
  doneTitle: "Die Seitenzahlen wurden hinzugefügt!",
  downloadLabel: "PDF herunterladen",
};

const TEMPLATES = [
  { value: "{n}", label: "Nur die Seitenzahl einfügen (empfohlen)" },
  { value: "Seite {n}", label: "Seite {n}" },
  { value: "Seite {n} von {p}", label: "Seite {n} von {p}" },
  { value: "custom", label: "Benutzerdefiniert" },
];

export function PageNumbersTool() {
  const { items, add, remove, loading } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const [opts, setOpts] = useState<PageNumberOptions>({
    vertical: "bottom",
    horizontal: "center",
    margin: "medium",
    firstNumber: 1,
    fromPage: 1,
    toPage: 0,
    template: "{n}",
    fontSize: 12,
    color: "#000000",
    bold: false,
    facingPages: false,
  });
  const [templateChoice, setTemplateChoice] = useState("{n}");
  const [customText, setCustomText] = useState("Seite {n} von {p}");
  const set = (patch: Partial<PageNumberOptions>) => setOpts((o) => ({ ...o, ...patch }));

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
  if (stage === "done") return <Done texts={texts} files={output} zipName="seitenzahlen.zip" onBack={() => setStage("work")} />;

  const template = templateChoice === "custom" ? customText : templateChoice;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={valid.length > 0 && !loading && template.trim().length > 0}
        onProcess={() =>
          run(() =>
            Promise.all(
              valid.map(async (it) => ({
                name: it.file.name.replace(/\.pdf$/i, "") + "_nummeriert.pdf",
                bytes: await addPageNumbers(it.bytes, {
                  ...opts,
                  template,
                  fromPage: single ? opts.fromPage : 1,
                  toPage: single ? toPage : it.pageCount,
                }),
              })),
            ),
          )
        }
        sidebar={
          <>
            <Opt title="Seitenmodus">
              <Seg
                value={opts.facingPages ? "facing" : "single"}
                onChange={(v) => set({ facingPages: v === "facing" })}
                options={[
                  { value: "single", label: "Einzelne Seite" },
                  { value: "facing", label: "Gegenüberliegende Seiten" },
                ]}
              />
            </Opt>
            <Opt title="Position:">
              <div className="tl-opt__row" style={{ alignItems: "flex-start", gap: 24 }}>
                <PositionGrid
                  rows={["top", "bottom"]}
                  vertical={opts.vertical}
                  horizontal={opts.horizontal}
                  onChange={(vertical, horizontal) => set({ vertical, horizontal })}
                />
                <div style={{ flex: 1 }}>
                  <div className="tl-opt__title">Rand:</div>
                  <select
                    className="tl-select"
                    value={opts.margin}
                    onChange={(e) => set({ margin: e.target.value as PageNumberOptions["margin"] })}
                    aria-label="Rand"
                  >
                    <option value="small">Klein</option>
                    <option value="medium">Empfohlen</option>
                    <option value="big">Groß</option>
                  </select>
                </div>
              </div>
            </Opt>
            <Opt title="Seiten">
              <div className="tl-opt__row" style={{ marginBottom: 12 }}>
                <span>Erste Zahl:</span>
                <NumberInput value={opts.firstNumber} min={0} ariaLabel="Erste Zahl" onChange={(firstNumber) => set({ firstNumber })} />
              </div>
              {single ? (
                <>
                  <div className="tl-opt__title">Welche Seiten möchten Sie nummerieren?</div>
                  <PageRangeInputs
                    from={opts.fromPage}
                    to={toPage}
                    max={count}
                    onChange={(fromPage, toPage) => set({ fromPage, toPage })}
                  />
                </>
              ) : (
                <Info>
                  <p>Alle Seiten werden nummeriert, da mehrere PDFs ausgewählt wurden.</p>
                </Info>
              )}
            </Opt>
            <Opt title="Text:">
              <select className="tl-select" value={templateChoice} onChange={(e) => setTemplateChoice(e.target.value)} aria-label="Text">
                {TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {templateChoice === "custom" && (
                <>
                  <div className="tl-opt__title" style={{ marginTop: 12 }}>
                    Benutzerdefinierter Text:
                  </div>
                  <input
                    className="tl-input tl-input--full"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    aria-label="Benutzerdefinierter Text"
                  />
                  <p className="tl-summary" style={{ marginTop: 6 }}>
                    {"{n}"} aktuelle Seitenzahl · {"{p}"} Gesamtseitenzahl
                  </p>
                </>
              )}
            </Opt>
            <Opt title="Textformat:">
              <div className="tl-opt__row">
                <NumberInput value={opts.fontSize} min={6} max={72} ariaLabel="Schriftgröße" onChange={(fontSize) => set({ fontSize })} />
                <input
                  type="color"
                  value={opts.color}
                  onChange={(e) => set({ color: e.target.value })}
                  aria-label="Schriftfarbe"
                  style={{ width: 40, height: 40, border: "1px solid #c2c2cc", borderRadius: 8, padding: 2 }}
                />
                <Check checked={opts.bold} onChange={(bold) => set({ bold })}>
                  Fett
                </Check>
              </div>
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
