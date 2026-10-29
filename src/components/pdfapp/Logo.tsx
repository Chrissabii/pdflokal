import Link from "next/link";
import { BRAND } from "./brand";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="pa-logo__mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M10 7h8.5l4.5 4.5V25H10z" fill="#fff" />
      <path d="M18.5 7v4.5H23" fill="#c7d2fe" />
      <path d="M13 15h7M13 18.5h7M13 22h4" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark "PDFlokal": the second half is set in the brand color. */
export function Logo() {
  const split = BRAND.name.startsWith("PDF") ? 3 : BRAND.name.length;
  return (
    <Link href="/" className="pa-logo" aria-label={`${BRAND.name} – Startseite`}>
      <LogoMark />
      <span>
        {BRAND.name.slice(0, split)}
        <span className="pa-logo__accent">{BRAND.name.slice(split)}</span>
      </span>
    </Link>
  );
}
