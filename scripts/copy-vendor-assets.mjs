// Copies runtime assets from node_modules into public/ so the PDF tools work without a CDN (offline-capable):
// - pdf.js worker (thumbnails, text extraction)
// - DejaVu fonts (Unicode text in translated PDFs)
// - ONNX Runtime WASM (in-browser Opus-MT translation via transformers.js)
// - Tesseract worker, WASM core and language data (OCR for scanned pages)
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Finds a package directory the way Node does (nested node_modules first, then parents).
// Some packages don't export ./package.json, so require.resolve can't be used.
function pkgDir(name, from = process.cwd()) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) throw new Error(`Package not found: ${name}`);
  }
}

const copies = [
  [join(pkgDir("pdfjs-dist"), "build", "pdf.worker.min.mjs"), "public/pdfjs/pdf.worker.min.mjs"],
  [join(pkgDir("dejavu-fonts-ttf"), "ttf", "DejaVuSans.ttf"), "public/fonts/DejaVuSans.ttf"],
  [join(pkgDir("dejavu-fonts-ttf"), "ttf", "DejaVuSans-Bold.ttf"), "public/fonts/DejaVuSans-Bold.ttf"],
  [join(pkgDir("dejavu-fonts-ttf"), "ttf", "DejaVuSerif.ttf"), "public/fonts/DejaVuSerif.ttf"],
  [join(pkgDir("dejavu-fonts-ttf"), "ttf", "DejaVuSerif-Bold.ttf"), "public/fonts/DejaVuSerif-Bold.ttf"],
  [join(pkgDir("tesseract.js"), "dist", "worker.min.js"), "public/tesseract/worker.min.js"],
];

// onnxruntime-web as resolved by transformers.js (versions must match)
const ortDist = join(pkgDir("onnxruntime-web", pkgDir("@huggingface/transformers")), "dist");
for (const f of readdirSync(ortDist).filter((f) => f.startsWith("ort-wasm-simd-threaded"))) {
  copies.push([join(ortDist, f), `public/ort/${f}`]);
}

// Tesseract LSTM cores (tesseract.js picks the best variant for the browser)
const core = pkgDir("tesseract.js-core", pkgDir("tesseract.js"));
for (const f of readdirSync(core).filter((f) => /^tesseract-core.*lstm\.(wasm\.js|js|wasm)$/.test(f))) {
  copies.push([join(core, f), `public/tesseract/core/${f}`]);
}

for (const lang of ["deu", "eng", "fra", "spa", "ita", "nld"]) {
  copies.push([
    join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`),
    `public/tesseract/lang/${lang}.traineddata.gz`,
  ]);
}

for (const [src, dest] of copies) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
