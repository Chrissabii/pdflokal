"use client";

import type { ReactNode } from "react";
import type { HPos, VPos } from "@/lib/pdf/operations";
import { FileCard, LazyThumb, useThumbSource } from "./shared";

export function Opt({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="tl-opt">
      {title && <div className="tl-opt__title">{title}</div>}
      {children}
    </div>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tl-seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="tl-seg__btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const V_LABEL: Record<VPos, string> = { top: "oben", middle: "Mitte", bottom: "unten" };
const H_LABEL: Record<HPos, string> = { left: "links", center: "Mitte", right: "rechts" };

export function PositionGrid({
  vertical,
  horizontal,
  onChange,
  rows = ["top", "middle", "bottom"],
  disabled,
}: {
  vertical: VPos;
  horizontal: HPos;
  onChange: (v: VPos, h: HPos) => void;
  rows?: VPos[];
  disabled?: boolean;
}) {
  const cols: HPos[] = ["left", "center", "right"];
  return (
    <div className="tl-grid9" role="group" aria-label="Position">
      {rows.flatMap((v) =>
        cols.map((h) => (
          <button
            key={`${v}-${h}`}
            type="button"
            disabled={disabled}
            aria-pressed={!disabled && v === vertical && h === horizontal}
            aria-label={`${V_LABEL[v]} ${H_LABEL[h]}`}
            title={`${V_LABEL[v]} ${H_LABEL[h]}`}
            onClick={() => onChange(v, h)}
          />
        )),
      )}
    </div>
  );
}

export function NumberInput({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      className="tl-input tl-input--num"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value === "" || Number.isNaN(n)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(n))));
      }}
    />
  );
}

export function PageRangeInputs({
  from,
  to,
  max,
  onChange,
}: {
  from: number;
  to: number;
  max: number;
  onChange: (from: number, to: number) => void;
}) {
  return (
    <div className="tl-opt__row">
      <span>von Seite</span>
      <NumberInput value={from} min={1} max={max} ariaLabel="von Seite" onChange={(v) => onChange(v, Math.max(v, to))} />
      <span>bis</span>
      <NumberInput value={to} min={1} max={max} ariaLabel="bis Seite" onChange={(v) => onChange(Math.min(from, v), v)} />
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="tl-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Grid of all pages of one PDF, with a click handler and per-page decoration. */
export function PageGrid({
  bytes,
  onPageClick,
  pageClass,
  pageLabel,
}: {
  bytes: ArrayBuffer;
  onPageClick?: (index: number, e: React.MouseEvent) => void;
  pageClass?: (index: number) => string | undefined;
  pageLabel?: (index: number) => string | undefined;
}) {
  const { source, pageCount, error } = useThumbSource(bytes, 140);
  if (error) return <div className="tl-info">{error}</div>;
  if (!source) return <div className="tl-file__preload" style={{ margin: "40px auto" }} />;
  return (
    <div className="tl-files">
      {Array.from({ length: pageCount }, (_, i) => (
        <LazyThumb key={i} source={source} index={i}>
          {(thumb) => (
            <>
              {pageLabel?.(i) && <span className="tl-file-num">{pageLabel(i)}</span>}
              <FileCard
                name={`Seite ${i + 1}`}
                thumb={thumb}
                className={["tl-file--page", pageClass?.(i)].filter(Boolean).join(" ")}
                dragProps={onPageClick ? { onClick: (e) => onPageClick(i, e) } : undefined}
              />
            </>
          )}
        </LazyThumb>
      ))}
    </div>
  );
}
