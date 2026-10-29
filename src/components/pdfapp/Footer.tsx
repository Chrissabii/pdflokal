import Link from "next/link";
import { BRAND } from "./brand";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="pa-footer">
      <div className="pa-footer__inner">
        <span className="pa-logo">
          <LogoMark size={26} /> {BRAND.name}
        </span>
        <span>Alle Dateien werden ausschließlich auf Ihrem Gerät verarbeitet.</span>
        <nav aria-label="Fußzeile">
          <Link href="/lizenzen/">Lizenzen &amp; Danksagungen</Link>
          {BRAND.sourceUrl && (
            <a href={BRAND.sourceUrl} target="_blank" rel="noopener">
              Quellcode
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
