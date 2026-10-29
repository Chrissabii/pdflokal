import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { BRAND } from "@/components/pdfapp/brand";
import { withBase } from "@/lib/base";
import "./globals.css";

// Inter (SIL Open Font License), bundled locally so the app works offline.
const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "../fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: `${BRAND.name} – ${BRAND.tagline}`, template: `%s – ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  icons: {
    icon: [{ url: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }],
    apple: withBase("/icons/apple-touch-icon.png"),
  },
  manifest: withBase("/manifest.webmanifest"),
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
