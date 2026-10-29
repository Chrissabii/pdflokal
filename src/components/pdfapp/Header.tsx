"use client";

import { ChevronDown, Menu, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOLS } from "./catalog";
import { InstallButton } from "./InstallButton";
import { Logo } from "./Logo";

function ToolTile({ color, Icon, size = 28 }: { color: string; Icon: (typeof TOOLS)[number]["icon"]; size?: number }) {
  return (
    <span className="pa-tile" style={{ width: size, height: size, background: color }}>
      <Icon size={Math.round(size * 0.57)} aria-hidden />
    </span>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="pa-header">
      <nav aria-label="Hauptnavigation">
        <Logo />
        <div className="pa-nav">
          <div className="pa-nav__item">
            <button type="button" className="pa-nav__link" aria-haspopup="true">
              Alle Werkzeuge <ChevronDown size={16} aria-hidden />
            </button>
            <div className="pa-menu">
              {TOOLS.map((t) => (
                <Link key={t.href} href={t.href}>
                  <ToolTile color={t.color} Icon={t.icon} />
                  {t.title}
                </Link>
              ))}
            </div>
          </div>
          <Link className="pa-nav__link" href="/pdf-ubersetzen/">
            PDF übersetzen
          </Link>
          <Link className="pa-nav__link" href="/pdf_zusammenfuegen/">
            Zusammenfügen
          </Link>
        </div>
        <div className="pa-header__right">
          <span className="pa-offline-badge">
            <WifiOff size={15} aria-hidden /> Funktioniert offline
          </span>
          <InstallButton />
          <button
            type="button"
            className="pa-burger"
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={26} aria-hidden /> : <Menu size={26} aria-hidden />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="pa-mobile" role="dialog" aria-label="Alle Werkzeuge">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href} onClick={() => setOpen(false)}>
              <ToolTile color={t.color} Icon={t.icon} size={32} />
              {t.title}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
