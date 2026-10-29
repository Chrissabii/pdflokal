// Browser-only: renders a text block with the device's own fonts into a PNG (used for scripts the
// bundled PDF font cannot draw). The browser handles shaping, ligatures and right-to-left text.
import type { RasterizeText } from "./write";

const SCALE = 3; // pixels per PDF point → sharp print output
const MIN_SIZE = 4;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    // languages without spaces (Chinese, Japanese, Thai) may break between any characters
    const tokens = /\s/.test(para.trim()) ? para.split(/(\s+)/) : [...para];
    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (ctx.measureText(candidate).width <= maxWidth || !line.trim()) line = candidate;
      else {
        lines.push(line.trim());
        line = token.trimStart();
      }
    }
    lines.push(line.trim());
  }
  return lines;
}

export function createRasterizer(rtl: boolean): RasterizeText {
  return async ({ text, width, height, fontSize, color, bold }) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const font = (size: number) => `${bold ? "bold " : ""}${size * SCALE}px system-ui, "Segoe UI", "Noto Sans", sans-serif`;
    let size = Math.max(MIN_SIZE, fontSize);
    let lines: string[] = [];
    for (;;) {
      ctx.font = font(size);
      lines = wrap(ctx, text, width * SCALE);
      if (lines.length * size * 1.3 <= height + size * 0.2 || size <= MIN_SIZE) break;
      size = Math.max(MIN_SIZE, size * 0.92);
    }
    const lineHeight = size * 1.3;
    const h = Math.max(lineHeight, lines.length * lineHeight);
    canvas.width = Math.ceil(width * SCALE);
    canvas.height = Math.ceil(h * SCALE);
    ctx.font = font(size);
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
    lines.forEach((line, i) => ctx.fillText(line, rtl ? canvas.width : 0, (i * lineHeight + size) * SCALE));
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    canvas.width = canvas.height = 0;
    if (!blob) return null;
    return { png: new Uint8Array(await blob.arrayBuffer()), height: h };
  };
}
