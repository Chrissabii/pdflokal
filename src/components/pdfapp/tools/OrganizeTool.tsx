"use client";

import { useEffect, useRef, useState } from "react";
import { organizePages, type PageRef } from "@/lib/pdf/operations";
import {
  Done,
  ErrorBanner,
  FileCard,
  Info,
  LazyThumb,
  ThumbSource,
  PDF_ACCEPT,
  Processing,
  Uploader,
  Workspace,
  nextId,
  useReorder,
  usePdfFiles,
  useToolRun,
  type PageThumb,
  type ToolTexts,
} from "./shared";

const texts: ToolTexts = {
  title: "PDF organisieren",
  subtitle:
    "Bringen Sie Seiten in die richtige Reihenfolge, drehen oder löschen Sie einzelne Seiten – auch aus mehreren Dateien.",
  pickLabel: "PDF-Datei auswählen",
  dropLabel: "oder PDF hierher ziehen",
  panelTitle: "PDF organisieren",
  actionLabel: "Organisieren",
  processingLabel: "PDFs werden organisiert...",
  doneTitle: "Die PDF wurde organisiert!",
  downloadLabel: "PDF herunterladen",
};

interface PageItem extends PageRef {
  key: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function OrganizeTool() {
  const { items, add, loading } = usePdfFiles();
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const [pages, setPages] = useState<PageItem[]>([]);
  // one lazy thumbnail renderer per file (only pages scrolled into view are rendered)
  const [sources, setSources] = useState<Map<number, ThumbSource>>(new Map());
  const loaded = useRef(new Set<string>());
  const reorder = useReorder(pages, setPages);

  // Expand every newly loaded file into its pages (appended at the end).
  useEffect(() => {
    items.forEach((item, fileIndex) => {
      if (!item.pageCount || loaded.current.has(item.id)) return;
      loaded.current.add(item.id);
      const fresh: PageItem[] = Array.from({ length: item.pageCount }, (_, page) => ({
        key: nextId(),
        file: fileIndex,
        page,
        rotation: 0,
      }));
      setPages((prev) => [...prev, ...fresh]);
      setSources((prev) => new Map(prev).set(fileIndex, new ThumbSource(item.bytes, 140)));
    });
  }, [items]);

  useEffect(() => () => sources.forEach((s) => s.destroy()), [sources]);

  const onFiles = (files: File[]) => {
    add(files);
    setStage("work");
  };

  if (stage === "upload") return <Uploader texts={texts} accept={PDF_ACCEPT} multiple onFiles={onFiles} />;
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done") return <Done texts={texts} files={output} zipName="organisiert.zip" onBack={() => setStage("work")} />;

  const reset = () => {
    setPages((prev) =>
      [...prev].sort((a, b) => a.file - b.file || a.page - b.page).map((p) => ({ ...p, rotation: 0 })),
    );
  };
  const multi = items.length > 1;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={PDF_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={pages.length > 0 && !loading}
        onProcess={() =>
          run(async () => [
            {
              name: (items[0]?.file.name.replace(/\.pdf$/i, "") ?? "dokument") + "_organisiert.pdf",
              bytes: await organizePages(
                items.map((it) => it.bytes),
                pages,
              ),
            },
          ])
        }
        sidebar={
          <>
            <Info>
              <p>Ziehen Sie die Seiten in die gewünschte Reihenfolge. Über die Symbole auf einer Seite können Sie sie drehen oder löschen.</p>
            </Info>
            <button type="button" className="tl-link-btn" onClick={reset}>
              ↺ Alle zurücksetzen
            </button>
            <div className="tl-opt">
              <div className="tl-opt__title">Dateien:</div>
              <ul className="tl-summary">
                {items.map((it, i) => (
                  <li key={it.id}>
                    {multi && <strong>{LETTERS[i % 26]}: </strong>}
                    {it.file.name} ({it.pageCount} {it.pageCount === 1 ? "Seite" : "Seiten"})
                  </li>
                ))}
              </ul>
            </div>
            <div className="tl-summary">
              Seiten im Ergebnis: <strong>{pages.length}</strong>
            </div>
          </>
        }
      >
        <div className="tl-files">
          {pages.map((p, i) => {
            const card = (thumb?: PageThumb) => (
              <>
                <span className="tl-file-num">{multi ? `${LETTERS[p.file % 26]}${p.page + 1}` : p.page + 1}</span>
                <FileCard
                  name={`Seite ${i + 1}`}
                  thumb={thumb}
                  rotation={p.rotation}
                  className="tl-file--page"
                  dragProps={reorder(i)}
                  onRotate={() => setPages(pages.map((x) => (x.key === p.key ? { ...x, rotation: (x.rotation + 90) % 360 } : x)))}
                  onRemove={() => setPages(pages.filter((x) => x.key !== p.key))}
                />
              </>
            );
            const source = sources.get(p.file);
            return source ? (
              <LazyThumb key={p.key} source={source} index={p.page}>
                {card}
              </LazyThumb>
            ) : (
              <div key={p.key} style={{ position: "relative" }}>
                {card()}
              </div>
            );
          })}
        </div>
      </Workspace>
    </>
  );
}
