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
  assert.equal(P.fixNumbers("Auf 350°F (17°C) vorheizen", "Preheat to 350°F (175°C)"), "Auf 350°F (175°C) vorheizen");
  assert.equal(P.fixNumbers("1,5 Tassen und 2 Eier", "2 eggs and 1.5 cups"), "1,5 Tassen und 2 Eier");
  const builtIn = P.withBuiltInGlossary([], "en", "de");
  assert.equal(P.applyGlossary("This method makes cookies", builtIn), "This method makes cookies");
  const dirPlan = P.planTranslation(["Directions"], builtIn);
  assert.deepEqual([dirPlan.queue, P.assemble(dirPlan, [])], [[], ["Zubereitung"]]);
  assert.equal(P.withBuiltInGlossary(P.parseGlossary("unsalted = ohne Salz"), "en", "de").find((e) => e.from === "unsalted").to, "ohne Salz");
  const caps = P.toUnit("FARINE PER USO DOMESTICO");
  assert.equal(caps.core, "Farine per uso domestico");
  assert.ok(caps.caps);
  assert.equal(P.toUnit("Introduzione p. 9").suffix, " p. 9");
  assert.equal(P.toUnit("1000 gr").core, "");
  assert.deepEqual(["SUCCesso", "Successo", "FROLLE", "di", "pAsta,"].map(P.fixCase), ["Successo", "Successo", "FROLLE", "di", "pasta,"]);
  const plan = P.planTranslation(["FARINE\nIntroduzione p. 9", "Introduzione p. 9"], P.parseGlossary("farine = Mehle"));
  assert.deepEqual(plan.queue, ["Introduzione"]);
  assert.deepEqual(P.assemble(plan, ["Einleitung"]), ["MEHLE\nEinleitung p. 9", "Einleitung p. 9"]);
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

test("translated text keeps bold/serif style of the original", async () => {
  const W = await import("../src/lib/pdf/translate/write.ts");
  const { readFileSync } = await import("node:fs");
  const font = (name) => readFileSync(new URL(`../node_modules/dejavu-fonts-ttf/ttf/${name}.ttf`, import.meta.url)).buffer;
  const fonts = { regular: font("DejaVuSans"), bold: font("DejaVuSans-Bold"), serif: font("DejaVuSerif"), serifBold: font("DejaVuSerif-Bold") };
  const block = (text, style) => ({ x: 70, y: 600, width: 300, height: 30, fontSize: 20, text, lineCount: 1, color: [0, 0, 0], background: [1, 1, 1], ...style });
  const pagesIn = [{ index: 0, skipped: 0, ocr: false, blocks: [block("Titel", { serif: true, bold: true }), { ...block("Text", {}), y: 500 }] }];
  assert.ok(W.nearlyEqual("FUNKYBATTERCREAMTM Batch", "FUNKYBATTERCREAM™ Batch"));
  assert.equal(W.nearlyEqual("Die Rezepte", "Le ricette"), false);
  assert.equal(W.restoreSymbols("FUNKYBATTERCREAMTM Leitfaden", "FUNKYBATTERCREAM™ Guide"), "FUNKYBATTERCREAM™ Leitfaden");
  const out = await PDFDocument.load(await W.writeTranslatedPdf(A, pagesIn, [["Überschrift", "Fließtext"]], "layout", fonts));
  const names = out.context.enumerateIndirectObjects().map(([, o]) => String(o.get?.(out.context.obj("BaseFont")) ?? "")).filter(Boolean);
  assert.ok(names.some((n) => n.includes("DejaVuSerif-Bold")), names.join());
  assert.ok(names.some((n) => /DejaVuSans-\d+$/.test(n)), names.join());
});

test("table cells stay separate blocks, paragraphs still join", () => {
  const run = (str, x, y) => ({ x, y, right: x + str.length * 5, size: 10, str });
  const rows = Lay.buildBlocks(Lay.buildLines([run("Calories", 50, 700), run("214", 120, 700), run("Total fat", 200, 700), run("Sodium", 50, 688), run("181mg", 120, 688), run("Sugars", 200, 688)]));
  assert.equal(rows.length, 6);
  const para = Lay.buildBlocks(Lay.buildLines([run("This family favorite casserole is good for breakfast or lunch. Add", 50, 600), run("more flavor by topping it with fresh tomato salsa.", 50, 588)]));
  assert.equal(para.length, 1);
});

test("image pieces of one headline are merged into one OCR area", async () => {
  const pieces = [0, 1, 2].map((i) => ({ x: 100 + i * 52, y: 700, width: 50, height: 30 }));
  assert.deepEqual(Lay.mergeRects([...pieces, { x: 60, y: 200, width: 400, height: 300 }]), [
    { x: 100, y: 700, width: 154, height: 30 },
    { x: 60, y: 200, width: 400, height: 300 },
  ]);
});

test("original text is removed from the page instead of covered (page and form XObject)", async () => {
  const { removeTextInBoxes } = await import("../src/lib/pdf/translate/strip.ts");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const { readFileSync } = await import("node:fs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // inner page → becomes a form XObject (how Canva stores its text)
  const src = await PDFDocument.create();
  src.registerFontkit(fontkit);
  const dejavu = await src.embedFont(readFileSync(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", import.meta.url)));
  const helv = await src.embedFont(StandardFonts.Helvetica);
  const inner = src.addPage([595, 842]);
  inner.drawText("Pasta frolla", { x: 70, y: 600, size: 20, font: dejavu });
  const outer = await PDFDocument.create();
  const page = outer.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.9, 0.6, 0.2) });
  page.drawPage(await outer.embedPage((await PDFDocument.load(await (async () => { inner.drawText("Ciao mondo", { x: 70, y: 700, size: 20, font: helv }); return src.save(); })())).getPage(0)));
  page.drawText("Tienimi", { x: 70, y: 500, size: 20, font: await outer.embedFont(StandardFonts.Helvetica) });
  // like PDFs printed from Chrome/Edge: a transform that is never restored
  const { concatTransformationMatrix } = await import("pdf-lib");
  page.pushOperators(concatTransformationMatrix(0.5, 0, 0, 0.5, 0, 0));
  const doc = await PDFDocument.load(await outer.save());
  const { removed, colors } = removeTextInBoxes(doc, doc.getPage(0), [
    { x: 65, y: 693, width: 200, height: 26 },
    { x: 65, y: 593, width: 200, height: 26 },
  ]);
  assert.ok(removed[0] >= 10 && removed[1] >= 12, String(removed));
  assert.deepEqual(colors[0], [0, 0, 0]);
  doc.getPage(0).drawText("Hallo Welt", { x: 70, y: 700, size: 20, font: await doc.embedFont(StandardFonts.Helvetica) });
  const pdf = await getDocument({ data: await doc.save(), verbosity: 0 }).promise;
  const p = await pdf.getPage(1);
  const text = (await p.getTextContent()).items.map((i) => i.str).join("|");
  assert.equal(text.includes("Ciao") || text.includes("Pasta"), false, text);
  assert.ok(text.includes("Hallo Welt"), text);
  const hallo = (await p.getTextContent()).items.find((i) => i.str === "Hallo Welt");
  assert.deepEqual([hallo.transform[0], hallo.transform[4]], [20, 70], "translation drawn without the original's open transform");
  assert.ok(text.includes("Tienimi"), text);
  const ops = await p.getOperatorList();
  assert.ok(ops.fnArray.length > 5, "background drawing kept");
});

test("language detection and translation routes", () => {
  assert.equal(Lang.detectLanguage("Generalmente le farine che si trovano al supermercato si dividono in farina"), "it");
  assert.equal(Lang.detectLanguage("Das ist ein ganz normaler deutscher Satz über das Backen von Brot."), "de");
  assert.deepEqual(Lang.opusRoute("it", "de").map((s) => s.model), ["Xenova/opus-mt-it-en", "Xenova/opus-mt-en-de"]);
  assert.deepEqual(Lang.opusRoute("it", "pl")[1], { model: "Xenova/opus-mt-en-mul", prefix: ">>pol<< " });
  assert.equal(Lang.opusRoute("de", "ja")[1].model, "Xenova/opus-mt-en-jap");
  assert.equal(Lang.opusRoute("it", "ko"), null);
});
