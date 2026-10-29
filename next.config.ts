import type { NextConfig } from "next";

// Sub-folder deployments (GitHub Pages project sites: https://<user>.github.io/<repo>/) set
// NEXT_PUBLIC_BASE_PATH="/<repo>" at build time; leave it empty for local use or a root domain.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Static export: `npm run build` writes a self-contained site to out/ that runs without a Node server.
  // Together with the service worker (scripts/generate-sw.mjs) it works as an installable offline app.
  output: "export",
  // /pdf_teilen/ → out/pdf_teilen/index.html, which every static host and file server understands.
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: basePath || undefined,
};

export default nextConfig;
