import { Heart, Lock, Monitor, Smartphone, WifiOff } from "lucide-react";
import { AppFrame } from "./AppFrame";
import { Footer } from "./Footer";
import { InstallButton } from "./InstallButton";
import { ToolGrid } from "./ToolGrid";

export function Home() {
  return (
    <AppFrame>
      <main className="pa-main">
        <section className="pa-hero">
          <h1>
            PDF-Werkzeuge, die <em>auf Ihrem Gerät</em> bleiben
          </h1>
          <p>
            Zusammenfügen, teilen, drehen, beschriften und sogar übersetzen – direkt im Browser. Ihre Dateien werden nirgendwohin
            hochgeladen, und nach der Installation funktioniert alles auch ohne Internet.
          </p>
          <div className="pa-chips">
            <span className="pa-chip">
              <Lock size={15} aria-hidden /> Kein Upload
            </span>
            <span className="pa-chip">
              <WifiOff size={15} aria-hidden /> Funktioniert offline
            </span>
            <span className="pa-chip">
              <Heart size={15} aria-hidden /> Kostenlos &amp; Open Source
            </span>
          </div>
        </section>

        <ToolGrid />

        <section className="pa-section" aria-labelledby="install-title">
          <div className="pa-section__inner">
            <h2 id="install-title">Als App installieren</h2>
            <p className="pa-section__lead">
              Einmal installiert, startet die App wie ein normales Programm – auch ohne Internetverbindung.
            </p>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
              <InstallButton className="pa-btn" />
            </div>
            <div className="pa-steps">
              <div className="pa-step">
                <h3>
                  <Monitor size={20} aria-hidden /> PC (Chrome / Edge)
                </h3>
                <ol>
                  <li>Diese Seite öffnen.</li>
                  <li>In der Adressleiste auf das Installieren-Symbol klicken.</li>
                  <li>Warten, bis „vollständig offline verfügbar“ erscheint.</li>
                </ol>
              </div>
              <div className="pa-step">
                <h3>
                  <Smartphone size={20} aria-hidden /> Android (Chrome)
                </h3>
                <ol>
                  <li>Menü ⋮ öffnen.</li>
                  <li>„App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.</li>
                  <li>Die App über das neue Symbol starten.</li>
                </ol>
              </div>
              <div className="pa-step">
                <h3>
                  <Smartphone size={20} aria-hidden /> iPhone / iPad (Safari)
                </h3>
                <ol>
                  <li>Auf „Teilen“ tippen.</li>
                  <li>„Zum Home-Bildschirm“ wählen.</li>
                  <li>Die App über das neue Symbol starten.</li>
                </ol>
              </div>
            </div>
            <p className="pa-section__lead" style={{ fontSize: 14, color: "var(--muted)" }}>
              Für die Übersetzung wird das Sprachmodell einmalig heruntergeladen (ca. 100 MB je Sprachrichtung) und danach offline
              genutzt.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </AppFrame>
  );
}
