"use client";

import { useState } from "react";
import { extractPages, fixedRanges, splitByRanges, type PageRange } from "@/lib/pdf/operations";
import { Check, NumberInput, Opt, PageGrid, PageRangeInputs, Seg } from "./controls";
import { Done, ErrorBanner, Info, PDF_ACCEPT, Processing, Uploader, Workspace, usePdfFiles, useToolRun, type ToolTexts } from "./shared";
import { usePageSelection } from "./usePageSelection";

const texts: ToolTexts = {
  title: "PDF teilen",
  subtitle:
    "Trennen Sie Seitenbereiche ab oder speichern Sie ausgewählte Seiten als eigene PDF-Dateien.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "Teilen",
  actionLabel: "PDF teilen",
  processingLabel: "PDF wird geteilt...",
  doneTitle: "Die PDF-Datei wurde geteilt!",
  downloadLabel: "Geteilte PDF herunterladen",
};

type Tab = "range" | "pages";

const RANGE_COLORS = ["#e14242", "#28c7dc", "#ffa31a", "#5565be", "#43a29a", "#ee5f90", "#94c859", "#ac48bd"];

export function SplitTool() {
  const { items, add } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  // Mirror the source: "Seiten extrahieren" links to #split,extract. Only read on the client,
  // and the tab is not rendered before a file is chosen, so SSR output is unaffected.
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && window.location.hash.includes("extract") ? "pages" : "range",
  );
  const [rangeMode, setRangeMode] = useState<"custom" | "fixed">("custom");
  // null = default single range covering the whole document
  const [customRanges, setRanges] = useState<PageRange[] | null>(null);
  const [fixedSize, setFixedSize] = useState(1);
  const [mergeRanges, setMergeRanges] = useState(false);
  const [extractMode, setExtractMode] = useState<"all" | "select">("all");
  const [mergeExtracted, setMergeExtracted] = useState(false);
  const selection = usePageSelection();

  const file = items[0];
  const count = file?.pageCount ?? 0;

  const ranges = customRanges ?? [{ from: 1, to: Math.max(1, count) }];

  const onFiles = (files: File[]) => {
    add(files.slice(0, 1));
    setStage("work");
  };

  if (stage === "upload") return <Uploader texts={texts} accept={PDF_ACCEPT} multiple={false} onFiles={onFiles} />;
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done") {
    const zip = `${file.file.name.replace(/\.pdf$/i, "")}_geteilt.zip`;
    return <Done texts={texts} files={output} zipName={zip} onBack={() => setStage("work")} />;
  }

  const activeRanges = rangeMode === "fixed" ? fixedRanges(count, fixedSize) : ranges;
  const extractIndices = extractMode === "all" ? Array.from({ length: count }, (_, i) => i) : [...selection.selected];
  const outputs =
    tab === "range" ? (mergeRanges ? 1 : activeRanges.length) : mergeExtracted ? Math.min(1, extractIndices.length) : extractIndices.length;

  const rangeOf = (i: number) => activeRanges.findIndex((r) => i + 1 >= r.from && i + 1 <= r.to);

  const process = () =>
    run(() =>
      tab === "range"
        ? splitByRanges(file.bytes, file.file.name, activeRanges, mergeRanges)
        : extractPages(file.bytes, file.file.name, extractIndices, mergeExtracted),
    );

  const sidebar = (
    <>
      <div className="tl-tabs">
        <button type="button" className="tl-tab" aria-pressed={tab === "range"} onClick={() => setTab("range")}>
          Bereich
        </button>
        <button type="button" className="tl-tab" aria-pressed={tab === "pages"} onClick={() => setTab("pages")}>
          Seiten
        </button>
      </div>

      {tab === "range" ? (
        <>
          <Opt title="Seitenmodus:">
            <Seg
              value={rangeMode}
              onChange={setRangeMode}
              options={[
                { value: "custom", label: "Benutzerdefiniert" },
                { value: "fixed", label: "Fest" },
              ]}
            />
          </Opt>
          {rangeMode === "custom" ? (
            <>
              {ranges.map((r, i) => (
                <div key={i} className="tl-range-box" style={{ borderLeft: `4px solid ${RANGE_COLORS[i % RANGE_COLORS.length]}` }}>
                  <div className="tl-range-box__head">
                    Bereich {i + 1}
                    {ranges.length > 1 && (
                      <button
                        type="button"
                        className="tl-range-box__remove"
                        aria-label={`Bereich ${i + 1} entfernen`}
                        onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <PageRangeInputs
                    from={r.from}
                    to={r.to}
                    max={count || 1}
                    onChange={(from, to) => setRanges(ranges.map((x, j) => (j === i ? { from, to } : x)))}
                  />
                </div>
              ))}
              <button
                type="button"
                className="tl-link-btn"
                onClick={() => {
                  const last = ranges[ranges.length - 1];
                  const start = Math.min(count, (last?.to ?? 0) + 1) || 1;
                  setRanges([...ranges, { from: start, to: count || 1 }]);
                }}
              >
                + Seitenbereich hinzufügen
              </button>
              <Opt>
                <Check checked={mergeRanges} onChange={setMergeRanges}>
                  Alle Bereiche in eine einzige PDF-Datei zusammenfügen.
                </Check>
              </Opt>
            </>
          ) : (
            <>
              <Opt title="Aufteilen nach Seitenbereichen von:">
                <NumberInput value={fixedSize} min={1} max={count || 1} ariaLabel="Seiten pro Datei" onChange={setFixedSize} />
              </Opt>
              <Info>
                <p>
                  Dieses PDF wird in Dateien mit {fixedSize} {fixedSize === 1 ? "Seite" : "Seiten"} aufgeteilt.{" "}
                  <strong>{activeRanges.length}</strong> {activeRanges.length === 1 ? "PDF wird" : "PDFs werden"} erstellt.
                </p>
              </Info>
            </>
          )}
        </>
      ) : (
        <>
          <Opt title="Extraktions-Modus:">
            <Seg
              value={extractMode}
              onChange={setExtractMode}
              options={[
                { value: "all", label: "Alle Seiten extrahieren" },
                { value: "select", label: "Seiten auswählen" },
              ]}
            />
          </Opt>
          {extractMode === "select" && (
            <Opt title="Zu extrahierende Seiten:">
              <input
                className="tl-input tl-input--full"
                placeholder="z. B. 1-3,5"
                value={selection.text}
                onChange={(e) => selection.setText(e.target.value, count)}
                aria-label="Zu extrahierende Seiten"
              />
            </Opt>
          )}
          <Opt>
            <Check checked={mergeExtracted} onChange={setMergeExtracted}>
              Alle extrahierten Seiten zu einer einzigen PDF-Datei zusammenfügen.
            </Check>
          </Opt>
          <Info>
            <p>
              {mergeExtracted
                ? "Die ausgewählten Seiten werden zu einer PDF-Datei zusammengefügt."
                : "Ausgewählte Seiten werden in separate PDF-Dateien konvertiert."}{" "}
              <strong>{outputs}</strong> {outputs === 1 ? "PDF wird" : "PDFs werden"} erzeugt.
            </p>
          </Info>
        </>
      )}
    </>
  );

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace texts={texts} accept={PDF_ACCEPT} multiple={false} sidebar={sidebar} canProcess={count > 0 && outputs > 0} onProcess={process}>
        {file && (
          <PageGrid
            bytes={file.bytes}
            onPageClick={
              tab === "pages" && extractMode === "select" ? (i, e) => selection.toggle(i, e.shiftKey) : undefined
            }
            pageClass={(i) =>
              tab === "pages" ? (extractMode === "all" || selection.selected.has(i) ? "tl-file--selected" : undefined) : undefined
            }
            pageLabel={(i) => {
              if (tab !== "range") return undefined;
              const r = rangeOf(i);
              return r >= 0 ? `Bereich ${r + 1}` : undefined;
            }}
          />
        )}
      </Workspace>
    </>
  );
}
