// Generates the app icons in public/icons (neutral own design: white document on red).
// Pure Node (zlib only); run once with `node scripts/make-icons.mjs` after changing the design.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const RED = [229, 50, 45];
const WHITE = [255, 255, 255];
const LINE = [242, 150, 146];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const S = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
          for (let i = 0; i < 4; i++) acc[i] += c[i];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 4; i++) raw[o + i] = Math.round(acc[i] / (S * S));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const insideRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
};

/** Document glyph in a unit box scaled to `s` around the center. */
function glyph(x, y, s) {
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  const [l, t, r, b, fold] = [0.27, 0.18, 0.73, 0.82, 0.14];
  const inPage = u >= l && u <= r && v >= t && v <= b && !(u > r - fold && v < t + fold && u - (r - fold) > v - t);
  if (!inPage) return null;
  if (u > r - fold && v < t + fold) return LINE; // folded corner
  for (const ly of [0.42, 0.52, 0.62, 0.72]) {
    const lineRight = ly === 0.72 ? 0.55 : 0.65;
    if (Math.abs(v - ly) < 0.022 && u > 0.35 && u < lineRight) return LINE;
  }
  return WHITE;
}

const variants = {
  // rounded tile for "any" purpose
  any: (x, y) => {
    if (!insideRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return [0, 0, 0, 0];
    return [...(glyph(x, y, 1) ?? RED), 255];
  },
  // full-bleed with the glyph inside the 80% safe zone (Android adaptive icons)
  maskable: (x, y) => [...(glyph(x, y, 0.78) ?? RED), 255],
};

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, png(size, variants.any));
writeFileSync("public/icons/maskable-512.png", png(512, variants.maskable));
writeFileSync("public/icons/apple-touch-icon.png", png(180, variants.maskable));
console.log("icons written to public/icons");
