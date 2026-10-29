"use client";

import { rotatePdf } from "@/lib/pdf/operations";
import { Opt } from "./controls";
import { Done, ErrorBanner, FileCard, Info, PDF_ACCEPT, Processing, Uploader, Workspace, usePdfFiles, useToolRun, type ToolTexts } from "./shared";

const texts: ToolTexts = {
  title: "PDF drehen",
  subtitle: "Drehen Sie ganze Dokumente um 90°, 180° oder 270° – gern auch mehrere Dateien auf einmal.",
  pickLabel: "PDF-Dateien auswählen",
  dropLabel: "oder PDF hierher ziehen",
  panelTitle: "PDF drehen",
  actionLabel: "PDF drehen",
  processingLabel: "PDF wird gedreht...",
  doneTitle: "Die PDFs wurden gedreht!",
  downloadLabel: "Gedrehte PDF herunterladen",
};

export function RotateTool() {
  const { items, setItems, add, remove, rotate, loading } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();

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
  if (stage === "done") return <Done texts={texts} files={output} zipName="gedreht.zip" onBack={() => setStage("work")} />;

  const valid = items.filter((it) => !it.error && it.pageCount > 0);
  const rotateAll = (delta: number) =>
    setItems(items.map((it) => ({ ...it, rotation: (it.rotation + delta + 360) % 360 })));

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={valid.length > 0 && !loading}
        onProcess={() =>
          run(() =>
            Promise.all(
              valid.map(async (it) => ({
                name: it.file.name.replace(/\.pdf$/i, "") + "_gedreht.pdf",
                bytes: await rotatePdf(it.bytes, it.rotation),
              })),
            ),
          )
        }
        sidebar={
          <>
            <Info>
              <p>
                Mauszeiger über die PDF-Datei bewegen, dann wird ein Icon erscheinen. Klicken Sie darauf, um die PDFs zu drehen.
              </p>
            </Info>
            <Opt title="Drehung">
              <div className="tl-seg">
                <button type="button" className="tl-seg__btn" onClick={() => rotateAll(90)}>
                  ↻ Rechts
                </button>
                <button type="button" className="tl-seg__btn" onClick={() => rotateAll(-90)}>
                  ↺ Links
                </button>
              </div>
            </Opt>
            <button type="button" className="tl-link-btn" onClick={() => setItems(items.map((it) => ({ ...it, rotation: 0 })))}>
              Alle zurücksetzen
            </button>
          </>
        }
      >
        <div className="tl-files">
          {items.map((it) => (
            <FileCard
              key={it.id}
              name={it.file.name}
              thumb={it.thumb}
              rotation={it.rotation}
              error={it.error}
              subtitle={it.rotation ? `${it.rotation}°` : undefined}
              onRotate={() => rotate(it.id, 90)}
              onRemove={() => remove(it.id)}
            />
          ))}
        </div>
      </Workspace>
    </>
  );
}
