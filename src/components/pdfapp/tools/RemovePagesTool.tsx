"use client";

import { removePages } from "@/lib/pdf/operations";
import { Opt, PageGrid } from "./controls";
import { Done, ErrorBanner, Info, PDF_ACCEPT, Processing, Uploader, Workspace, usePdfFiles, useToolRun, type ToolTexts } from "./shared";
import { usePageSelection } from "./usePageSelection";

const texts: ToolTexts = {
  title: "PDF-Seiten entfernen",
  subtitle:
    "Markieren Sie die Seiten, die weg sollen, und speichern Sie das Dokument ohne sie.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF-Datei hierher ziehen",
  panelTitle: "Seiten entfernen",
  actionLabel: "Seiten entfernen",
  processingLabel: "PDF-Seiten werden entfernt...",
  doneTitle: "Die Seiten wurden entfernt!",
  downloadLabel: "PDF herunterladen",
};

export function RemovePagesTool() {
  const { items, add } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const selection = usePageSelection();
  const file = items[0];
  const count = file?.pageCount ?? 0;

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
  if (stage === "done") return <Done texts={texts} files={output} zipName="seiten_entfernt.zip" onBack={() => setStage("work")} />;

  const removing = selection.selected.size;
  const valid = count > 0 && removing > 0 && removing < count;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple={false}
        canProcess={valid}
        onProcess={() =>
          run(async () => [
            {
              name: file.file.name.replace(/\.pdf$/i, "") + "_bearbeitet.pdf",
              bytes: await removePages(file.bytes, [...selection.selected]),
            },
          ])
        }
        sidebar={
          <>
            <Info>
              <p>
                Klicken Sie auf die Seiten, die aus dem Dokument entfernt werden sollen. Sie können die Shift-Taste nutzen, um
                Bereiche festzulegen.
              </p>
            </Info>
            <Opt>
              <div className="tl-summary">
                Seiten insgesamt: <strong>{count || "–"}</strong>
              </div>
            </Opt>
            <Opt title="Zu entfernende Seiten:">
              <input
                className="tl-input tl-input--full"
                placeholder="z. B. 2,4-6"
                value={selection.text}
                onChange={(e) => selection.setText(e.target.value, count)}
                aria-label="Zu entfernende Seiten"
              />
            </Opt>
            {count > 0 && removing >= count && (
              <Info>
                <p>Es muss mindestens eine Seite im Dokument verbleiben.</p>
              </Info>
            )}
          </>
        }
      >
        {file && (
          <PageGrid
            bytes={file.bytes}
            onPageClick={(i, e) => selection.toggle(i, e.shiftKey)}
            pageClass={(i) => (selection.selected.has(i) ? "tl-file--removed" : undefined)}
          />
        )}
      </Workspace>
    </>
  );
}
