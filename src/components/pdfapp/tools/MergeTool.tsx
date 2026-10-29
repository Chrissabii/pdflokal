"use client";

import { mergePdfs } from "@/lib/pdf/operations";
import {
  Done,
  ErrorBanner,
  FileCard,
  Info,
  PDF_ACCEPT,
  Processing,
  Uploader,
  Workspace,
  useReorder,
  usePdfFiles,
  useToolRun,
  type ToolTexts,
} from "./shared";

const texts: ToolTexts = {
  title: "PDFs zusammenfügen",
  subtitle: "Verbinden Sie mehrere PDF-Dateien zu einem Dokument – in genau der Reihenfolge, die Sie festlegen.",
  pickLabel: "PDF-Dateien auswählen",
  dropLabel: "oder PDF hierher ziehen",
  panelTitle: "PDFs zusammenfügen",
  actionLabel: "PDFs zusammenfügen",
  processingLabel: "PDFs werden zusammengefügt...",
  doneTitle: "Die PDFs wurden zusammengefügt!",
  downloadLabel: "Zusammengefügte PDF herunterladen",
};

export function MergeTool() {
  const { items, setItems, add, remove, rotate } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const reorder = useReorder(items, setItems);

  const onFiles = (files: File[]) => {
    add(files);
    setStage("work");
  };
  const valid = items.filter((it) => !it.error);

  if (stage === "upload") return <Uploader texts={texts} accept={PDF_ACCEPT} multiple onFiles={onFiles} />;
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done")
    return <Done texts={texts} files={output} zipName="zusammengefuegt.zip" onBack={() => setStage("work")} />;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={valid.length >= 2 && valid.every((it) => it.pageCount > 0)}
        onProcess={() =>
          run(async () => [
            { name: "zusammengefuegt.pdf", bytes: await mergePdfs(valid.map((it) => ({ bytes: it.bytes, rotation: it.rotation }))) },
          ])
        }
        sidebar={
          <>
            <Info>
              <p>Ziehen Sie die Dateien in die gewünschte Reihenfolge. Über die Symbole auf einer Datei können Sie sie drehen oder entfernen.</p>
            </Info>
            {valid.length < 2 && (
              <Info>
                <p>Fügen Sie mindestens eine weitere PDF-Datei hinzu – über das Plus-Symbol oder per Drag & Drop.</p>
                <p>Im Dateidialog können Sie mehrere Dateien auf einmal markieren (Strg bzw. Cmd gedrückt halten).</p>
              </Info>
            )}
            {items.length > 1 && (
              <button
                type="button"
                className="tl-link-btn"
                onClick={() => setItems([...items].sort((a, b) => a.file.name.localeCompare(b.file.name, "de", { numeric: true })))}
              >
                Nach Dateiname sortieren (A–Z)
              </button>
            )}
          </>
        }
      >
        <div className="tl-files">
          {items.map((it, i) => (
            <FileCard
              key={it.id}
              name={it.file.name}
              thumb={it.thumb}
              rotation={it.rotation}
              error={it.error}
              subtitle={it.pageCount ? `${it.pageCount} ${it.pageCount === 1 ? "Seite" : "Seiten"}` : undefined}
              onRemove={() => remove(it.id)}
              onRotate={() => rotate(it.id, 90)}
              dragProps={reorder(i)}
            />
          ))}
        </div>
      </Workspace>
    </>
  );
}
