// Minimal static file server for the exported app in out/ (no dependencies).
// Used once to open and install the app on this PC; after installation the service worker serves
// everything offline and this server is no longer needed.
//   npm run serve            → http://localhost:3001
//   PORT=8080 npm run serve
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const port = Number(process.env.PORT) || 3001;
// HOSTNAME=0.0.0.0 makes it reachable from other devices/containers (the Dockerfile sets it).
const host = process.env.HOSTNAME === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
// For testing a GitHub Pages build locally: serve out/ under the same base path (e.g. /pdflokal).
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

if (!existsSync(join(root, "index.html"))) {
  console.error("out/ fehlt – bitte zuerst `npm run build` ausführen.");
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (base && !(url.pathname === base || url.pathname.startsWith(base + "/"))) {
    res.writeHead(302, { Location: base + "/" }).end();
    return;
  }
  let path = normalize(join(root, decodeURIComponent(url.pathname.slice(base.length) || "/")));
  if (!path.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  const missing = !existsSync(path);
  if (missing) path = join(root, "404.html");
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  res.writeHead(missing ? 404 : 200, {
    "Content-Type": type,
    // the service worker must always be revalidated so updates are picked up
    "Cache-Control": path.endsWith("sw.js") ? "no-cache" : "public, max-age=0",
  });
  createReadStream(path).pipe(res);
}).listen(port, host, () => {
  console.log(`App läuft auf http://localhost:${port}${base}/`);
});
