// Run with `npm test` (Node 24: TypeScript sources are imported directly via type stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ops = await import("../src/lib/pdf/operations.ts");
const P = await import("../src/lib/pdf/translate/prepare.ts");
const Lay = await import("../src/lib/pdf/translate/layout.ts");
const Lang = await import("../src/lib/pdf/translate/languages.ts");

async function makePdf(label, pages, landscape = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage(landscape ? [842, 595] : [595, 842]);
    p.drawText(`${label} – Seite ${i}`, { x: 70, y: p.getHeight() - 120, size: 30, font, color: rgb(0.2, 0.2, 0.6) });
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
const pages = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();
const A = await makePdf("A", 2);
const B = await makePdf("B", 3);
const C = await makePdf("C", 1, true);

test("merge keeps all pages and per-file rotation", async () => {
  const out = await PDFDocument.load(await ops.mergePdfs([{ bytes: A }, { bytes: B }, { bytes: C, rotation: 90 }]));
  assert.equal(out.getPageCount(), 6);
  assert.equal(out.getPage(5).getRotation().angle, 90);
});

test("split by ranges, fixed ranges and extract", async () => {
  const files = await ops.splitByRanges(B, "B.pdf", [{ from: 1, to: 1 }, { from: 2, to: 3 }], false);
  assert.deepEqual(files.map((f) => f.name), ["B_1.pdf", "B_2-3.pdf"]);
  assert.deepEqual(await Promise.all(files.map((f) => pages(f.bytes))), [1, 2]);
  assert.deepEqual(ops.fixedRanges(5, 2), [{ from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 5 }]);
  assert.equal((await ops.extractPages(B, "B.pdf", [0, 2], true)).length, 1);
});

test("remove, rotate, organize without duplicating resources", async () => {
  assert.equal(await pages(await ops.removePages(B, [0, 2])), 1);
  const rot = await PDFDocument.load(await ops.rotatePdf(A, -90));
  assert.ok(rot.getPages().every((p) => p.getRotation().angle === 270));
  const reversed = await ops.organizePages([B], [2, 1, 0].map((page) => ({ file: 0, page, rotation: 0 })));
  const single = await ops.organizePages([B], [0, 1, 2].map((page) => ({ file: 0, page, rotation: 0 })));
  assert.ok(reversed.length < single.length * 1.2, "reordering must not duplicate shared fonts");
});

test("page numbers, watermark and crop (incl. rotated pages)", async () => {
  const rotated = (await ops.rotatePdf(C, 90)).buffer;
  for (const src of [A, rotated]) {
    const n = await pages(src);
    const nums = await ops.addPageNumbers(src, { vertical: "bottom", horizontal: "center", margin: "medium", firstNumber: 1, fromPage: 1, toPage: n, template: "Seite {n} von {p}", fontSize: 12, color: "#000000", bold: true, facingPages: true });
    assert.equal(await pages(nums), n);
    const wm = await ops.addWatermark(src, { mode: "text", text: "Vertraulich – äöüß", bold: false, italic: true, font: "Times", fontSize: 40, color: "#ff0000", imageScale: 0.3, vertical: "middle", horizontal: "center", mosaic: true, opacity: 0.5, rotation: 45, fromPage: 1, toPage: n });
    assert.equal(await pages(wm), n);
  }
  const cropped = await PDFDocument.load(await ops.cropPdf(A, { left: 0.1, top: 0.2, width: 0.5, height: 0.25 }, "all"));
  const box = cropped.getPage(0).getCropBox();
  assert.deepEqual([box.x, box.y, box.width, box.height].map(Math.round), [60, 463, 298, 211]);
});

test("translation preparation: units, caps, TOC, cleanup, glossary", () => {
  assert.equal(P.cleanTranslation("wird verwendet.....t.,.t....c", "è usata."), "wird verwendet.");
  assert.equal(P.cleanTranslation("Ja, ... aber", "Sì, ... ma"), "Ja, ... aber");
  const caps = P.toUnit("FARINE PER USO DOMESTICO");
  assert.equal(caps.core, "Farine per uso domestico");
  assert.ok(caps.caps);
  assert.equal(P.toUnit("Introduzione p. 9").suffix, " p. 9");
  assert.equal(P.toUnit("1000 gr").core, "");
  const plan = P.planTranslation(["FARINE\nIntroduzione p. 9", "Introduzione p. 9"], P.parseGlossary("farine = Mehle"));
  assert.deepEqual(plan.queue, ["Mehle", "Introduzione"]);
  assert.deepEqual(P.assemble(plan, ["Mehle", "Einleitung"]), ["MEHLE\nEinleitung p. 9", "Einleitung p. 9"]);
});

test("layout keeps list line breaks and joins wrapped paragraphs", () => {
  const line = (text, x, right, y) => ({ text, x, right, y, size: 10, runs: [] });
  assert.equal(
    Lay.groupText([line("Ingredienti:", 50, 120, 700), line(" 1000 gr Farina", 50, 160, 688), line(" 500 gr Burro", 50, 150, 676)]),
    "Ingredienti:\n• 1000 gr Farina\n• 500 gr Burro",
  );
  assert.equal(
    Lay.groupText([line("Generalmente le farine che si trovano al super-", 50, 400, 700), line("mercato si dividono.", 50, 200, 688)]),
    "Generalmente le farine che si trovano al supermercato si dividono.",
  );
});

test("language detection and translation routes", () => {
  assert.equal(Lang.detectLanguage("Generalmente le farine che si trovano al supermercato si dividono in farina"), "it");
  assert.equal(Lang.detectLanguage("Das ist ein ganz normaler deutscher Satz über das Backen von Brot."), "de");
  assert.deepEqual(Lang.opusRoute("it", "de").map((s) => s.model), ["Xenova/opus-mt-it-en", "Xenova/opus-mt-en-de"]);
  assert.deepEqual(Lang.opusRoute("it", "pl")[1], { model: "Xenova/opus-mt-en-mul", prefix: ">>pol<< " });
  assert.equal(Lang.opusRoute("de", "ja")[1].model, "Xenova/opus-mt-en-jap");
  assert.equal(Lang.opusRoute("it", "ko"), null);
});
