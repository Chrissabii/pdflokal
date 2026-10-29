"use client";

import { useEffect, useState } from "react";
import { withBase } from "@/lib/base";

type Status = { state: "idle" } | { state: "saving"; done: number; total: number } | { state: "ready" };

/**
 * Registers the generated service worker (production builds only) and shows a small notice while the
 * offline pack (translation runtime + OCR) is being saved.
 */
export function RegisterServiceWorker() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "offline-progress") return;
      const { done, total } = e.data as { done: number; total: number };
      setStatus(done >= total ? { state: "ready" } : { state: "saving", done, total });
    };
    // The service worker adds COOP/COEP headers; they only apply to pages it serves, so reload once
    // after it takes control to become cross-origin isolated (faster, multi-threaded translation).
    const reloadForIsolation = () => {
      if (self.crossOriginIsolated) return;
      try {
        if (sessionStorage.getItem("coi-reloaded")) return;
        sessionStorage.setItem("coi-reloaded", "1");
      } catch {
        return;
      }
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", reloadForIsolation);
    navigator.serviceWorker
      .register(withBase("/sw.js"), { scope: withBase("/") })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        reg.active?.postMessage("offline-status");
        if (navigator.serviceWorker.controller) reloadForIsolation();
      })
      .catch(() => {
        // not fatal: the app still works online
      });
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadForIsolation);
    };
  }, []);

  useEffect(() => {
    if (status.state !== "ready") return;
    let seen = false;
    try {
      seen = localStorage.getItem("offline-ready-seen") === "1";
      localStorage.setItem("offline-ready-seen", "1");
    } catch {
      // ignore
    }
    const id = setTimeout(() => setStatus({ state: "idle" }), seen ? 0 : 6000);
    return () => clearTimeout(id);
  }, [status.state]);

  if (status.state === "idle") return null;
  return (
    <div className="offline-toast" role="status" aria-live="polite">
      {status.state === "saving"
        ? `Offline-Paket wird gespeichert … ${Math.round((status.done / status.total) * 100)} %`
        : "✓ Die App ist jetzt vollständig offline verfügbar."}
    </div>
  );
}
