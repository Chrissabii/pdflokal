"use client";

import { useEffect, useRef, useState } from "react";
import { imagesToPdf, prepareImage, type ImagesToPdfOptions } from "@/lib/pdf/operations";
import { Check, Opt, Seg } from "./controls";
import {
  Done,
  ErrorBanner,
  FileCard,
  IMAGE_ACCEPT,
  Processing,
  Uploader,
  Workspace,
  nextId,
  useReorder,
  useToolRun,
  type ToolTexts,
} from "./shared";

const texts: ToolTexts = {
  title: "Bilder in PDF",
  subtitle: "Wandeln Sie Fotos und Bilder in ein PDF um – mit Seitengröße, Ausrichtung und Rand nach Wahl.",
  pickLabel: "Bilder auswählen",
  dropLabel: "oder Bilder hierher ziehen",
  panelTitle: "Optionen",
  actionLabel: "In PDF konvertieren",
  processingLabel: "Bilder werden in PDF konvertiert...",
  doneTitle: "Die Bilder wurden in PDF konvertiert!",
  downloadLabel: "PDF herunterladen",
};

interface ImageItem {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  rotation: number;
}

function readSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = url;
  });
}

export function JpgToPdfTool() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const { stage, setStage, output, error, setError, run } = useToolRun();
  const [opts, setOpts] = useState<ImagesToPdfOptions>({ orientation: "portrait", pageSize: "A4", margin: "none", mergeAll: true });
  const reorder = useReorder(images, setImages);
  const urls = useRef<string[]>([]);
  const set = (patch: Partial<ImagesToPdfOptions>) => setOpts((o) => ({ ...o, ...patch }));

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = async (files: File[]) => {
    const fresh = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return { id: nextId(), file, url, rotation: 0, ...(await readSize(url)) };
      }),
    );
    setImages((prev) => [...prev, ...fresh]);
  };

  if (stage === "upload")
    return (
      <Uploader
        texts={texts}
        accept={IMAGE_ACCEPT}
        multiple
        onFiles={(files) => {
          add(files);
          setStage("work");
        }}
      />
    );
  if (stage === "processing") return <Processing label={texts.processingLabel} />;
  if (stage === "done") return <Done texts={texts} files={output} zipName="bilder_pdf.zip" onBack={() => setStage("work")} />;

  const thumbFor = (it: ImageItem) => {
    const max = 160;
    const ratio = it.width / it.height;
    return { url: it.url, width: ratio >= 1 ? max : Math.round(max * ratio), height: ratio >= 1 ? Math.round(max / ratio) : max };
  };

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <Workspace
        texts={texts}
        accept={IMAGE_ACCEPT}
        multiple
        onAddFiles={add}
        canProcess={images.length > 0}
        onProcess={() =>
          run(async () => {
            const prepared = await Promise.all(
              images.map(async (it) => ({ ...(await prepareImage(it.file)), rotation: it.rotation })),
            );
            return imagesToPdf(prepared, opts);
          })
        }
        sidebar={
          <>
            <Opt title="Bildausrichtung">
              <Seg
                value={opts.orientation}
                onChange={(orientation) => set({ orientation })}
                options={[
                  { value: "portrait", label: "Hochformat" },
                  { value: "landscape", label: "Breitformat" },
                ]}
              />
            </Opt>
            <Opt title="Seitengröße">
              <select
                className="tl-select"
                value={opts.pageSize}
                onChange={(e) => set({ pageSize: e.target.value as ImagesToPdfOptions["pageSize"] })}
                aria-label="Seitengröße"
              >
                <option value="fit">Anpassen (Dieselbe Seitengröße wie das Bild)</option>
                <option value="A4">A4 (297 x 210 mm)</option>
                <option value="letter">US Brief (215x279,4 mm)</option>
              </select>
            </Opt>
            <Opt title="Rand">
              <Seg
                value={opts.margin}
                onChange={(margin) => set({ margin })}
                options={[
                  { value: "none", label: "Kein Rand" },
                  { value: "small", label: "Klein" },
                  { value: "big", label: "Groß" },
                ]}
              />
            </Opt>
            <Opt>
              <Check checked={opts.mergeAll} onChange={(mergeAll) => set({ mergeAll })}>
                Alle Bilder in eine einzige PDF-Datei zusammenfügen
              </Check>
            </Opt>
          </>
        }
      >
        <div className="tl-files">
          {images.map((it, i) => (
            <FileCard
              key={it.id}
              name={it.file.name}
              thumb={thumbFor(it)}
              rotation={it.rotation}
              dragProps={reorder(i)}
              onRotate={() => setImages(images.map((x) => (x.id === it.id ? { ...x, rotation: (x.rotation + 90) % 360 } : x)))}
              onRemove={() => setImages(images.filter((x) => x.id !== it.id))}
            />
          ))}
        </div>
      </Workspace>
    </>
  );
}
