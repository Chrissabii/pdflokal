// Base path when the app is served from a sub-folder (GitHub Pages: https://<user>.github.io/<repo>/).
// Set NEXT_PUBLIC_BASE_PATH="/<repo>" at build time; empty for a root deployment or local use.
// Next.js prefixes <Link> and _next assets itself; plain URLs (fetch, workers, <img>) go through withBase().
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export const withBase = (path: string) => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
