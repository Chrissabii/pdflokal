"use client";

import { useCallback, useRef, useState } from "react";
import { formatPageList, parsePageList } from "@/lib/pdf/operations";

/** Page selection shared by the page grid (click, shift+click ranges) and a "1-3,5" text field. */
export function usePageSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [text, setTextState] = useState("");
  const last = useRef<number | null>(null);

  const apply = useCallback((next: Set<number>) => {
    setSelected(next);
    setTextState(formatPageList([...next]));
  }, []);

  const toggle = useCallback(
    (index: number, shift: boolean) => {
      const next = new Set(selected);
      if (shift && last.current !== null) {
        const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)];
        const add = !selected.has(index);
        for (let i = a; i <= b; i++) {
          if (add) next.add(i);
          else next.delete(i);
        }
      } else if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      last.current = index;
      apply(next);
    },
    [selected, apply],
  );

  const setText = useCallback((value: string, pageCount: number) => {
    setTextState(value);
    setSelected(new Set(parsePageList(value, pageCount)));
  }, []);

  const clear = useCallback(() => apply(new Set()), [apply]);

  return { selected, text, toggle, setText, clear };
}
