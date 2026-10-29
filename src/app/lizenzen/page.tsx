import type { Metadata } from "next";
import { AppFrame } from "@/components/pdfapp/AppFrame";
import { BRAND } from "@/components/pdfapp/brand";
import { Footer } from "@/components/pdfapp/Footer";

export const metadata: Metadata = {
  title: "Lizenzen & Danksagungen",
};

const CREDITS: { name: string; use: string; license: string; url: string }[] = [
  { name: "pdf-lib", use: "PDFs erstellen und bearbeiten", license: "MIT", url: "https://github.com/Hopding/pdf-lib" },
  { name: "PDF.js (Mozilla)", use: "PDF-Vorschau und Texterkennung im PDF", license: "Apache-2.0", url: "https://github.com/mozilla/pdf.js" },
  { name: "Tesseract.js / Tesseract OCR", use: "Texterkennung in eingescannten Seiten", license: "Apache-2.0", url: "https://github.com/naptha/tesseract.js" },
  {
    name: "Opus-MT (Helsinki-NLP, Universität Helsinki)",
    use: "Übersetzungsmodelle; ONNX-Fassungen von Xenova auf Hugging Face",
    license: "CC BY 4.0",
    url: "https://github.com/Helsinki-NLP/Opus-MT",
  },
  { name: "Transformers.js (Hugging Face)", use: "Ausführung der Übersetzungsmodelle im Browser", license: "Apache-2.0", url: "https://github.com/huggingface/transformers.js" },
  { name: "ONNX Runtime Web (Microsoft)", use: "KI-Laufzeit im Browser", license: "MIT", url: "https://github.com/microsoft/onnxruntime" },
  { name: "fflate", use: "ZIP-Dateien für mehrere Ergebnisse", license: "MIT", url: "https://github.com/101arrowz/fflate" },
  { name: "Inter (Rasmus Andersson)", use: "Schrift der Benutzeroberfläche", license: "SIL Open Font License 1.1", url: "https://rsms.me/inter/" },
  { name: "DejaVu Sans", use: "Schrift für übersetzte Texte im PDF", license: "Bitstream Vera / Public Domain", url: "https://dejavu-fonts.github.io/" },
  { name: "Lucide", use: "Symbole", license: "ISC", url: "https://lucide.dev" },
  { name: "Next.js, React", use: "Grundgerüst der Web-App", license: "MIT", url: "https://nextjs.org" },
];

export default function Page() {
  return (
    <AppFrame>
      <main className="pa-main">
        <section className="pa-section" style={{ borderTop: 0 }}>
          <div className="pa-section__inner" style={{ maxWidth: 820 }}>
            <h2>Lizenzen &amp; Danksagungen</h2>
            <p className="pa-section__lead">
              {BRAND.name} ist kostenlos und verarbeitet alle Dateien ausschließlich auf Ihrem Gerät. Möglich machen das diese
              Open-Source-Projekte – vielen Dank an ihre Autorinnen und Autoren.
            </p>
            <ul style={{ marginTop: 32, display: "grid", gap: 12 }}>
              {CREDITS.map((c) => (
                <li key={c.name} className="pa-step" style={{ padding: 16 }}>
                  <a href={c.url} target="_blank" rel="noopener" style={{ fontWeight: 650, color: "var(--ink)" }}>
                    {c.name}
                  </a>
                  <div style={{ fontSize: 14 }}>
                    {c.use} · Lizenz: {c.license}
                  </div>
                </li>
              ))}
            </ul>
            <p className="pa-section__lead" style={{ fontSize: 14, color: "var(--muted)" }}>
              Maschinelle Übersetzungen können Fehler enthalten. Für rechtlich verbindliche Übersetzungen wenden Sie sich bitte an
              eine vereidigte Übersetzerin oder einen vereidigten Übersetzer.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </AppFrame>
  );
}
