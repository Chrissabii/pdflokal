import "./app.css";
import type { ReactNode } from "react";
import { Header } from "./Header";

/** Page shell shared by the home page, tool pages and the licenses page. */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pa">
      <Header />
      {children}
    </div>
  );
}
