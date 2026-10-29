"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORY_FILTERS, TOOLS, type ToolCategory } from "./catalog";

export function ToolGrid() {
  const [filter, setFilter] = useState<"all" | ToolCategory>("all");
  const visible = filter === "all" ? TOOLS : TOOLS.filter((t) => t.category === filter);

  return (
    <section className="pa-tools" aria-label="Werkzeuge">
      <div className="pa-filter" role="group" aria-label="Werkzeuge filtern">
        {CATEGORY_FILTERS.map((f) => (
          <button key={f.id} type="button" className="pa-pill" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="pa-grid">
        {visible.map((t) => (
          <Link key={t.href} href={t.href} className={`pa-card${t.isNew && filter === "all" ? " pa-card--featured" : ""}`}>
            {t.isNew && <span className="pa-badge">Neu</span>}
            <span className="pa-tile" style={{ width: 44, height: 44, background: t.color, borderRadius: 12 }}>
              <t.icon size={24} aria-hidden />
            </span>
            <h3>{t.title}</h3>
            <p>{t.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
