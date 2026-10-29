import "./tools.css";
import type { ReactNode } from "react";
import { AppFrame } from "../AppFrame";

export function ToolFrame({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
