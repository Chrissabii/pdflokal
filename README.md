# PDFlokal

PDF-Werkzeuge, die auf Ihrem Gerät bleiben: zusammenfügen, teilen, Seiten entfernen, organisieren, drehen,
Seitenzahlen, Wasserzeichen, zuschneiden, Bilder in PDF – und **PDF übersetzen** mit erhaltenem Layout,
auch für eingescannte Seiten (OCR).

- **Kein Upload:** Alle Dateien werden im Browser verarbeitet.
- **Offline-fähig:** Als App installierbar (PWA) auf PC und Handy; danach ohne Internet nutzbar.
- **Kostenlos & Open Source.**

## Lokal starten

Voraussetzung: Node.js 24.

```bash
npm install
npm run dev        # Entwicklung: http://localhost:3000
```

Produktionsversion bauen und lokal ausliefern (zum Installieren als App auf diesem PC):

```bash
npm run build      # statischer Export nach out/ + Service Worker
npm start          # http://localhost:3001
```

Dann im Browser (Chrome/Edge) das Installieren-Symbol in der Adressleiste nutzen. Danach wird der Server nicht mehr benötigt.

## Veröffentlichen mit GitHub Pages

1. Repository auf GitHub anlegen und den Code pushen (Branch `master`).
2. Im Repository: **Settings → Pages → Source: „GitHub Actions“**.
3. Der Workflow `.github/workflows/deploy-pages.yml` baut die App bei jedem Push und veröffentlicht sie unter
   `https://<benutzer>.github.io/<repository>/`.

Lokal testen mit demselben Unterpfad:

```bash
NEXT_PUBLIC_BASE_PATH=/<repository> npm run build
NEXT_PUBLIC_BASE_PATH=/<repository> npm start
```

Unter Windows in Git Bash zusätzlich `MSYS_NO_PATHCONV=1` voranstellen – sonst wandelt Git Bash `/<repository>`
in einen Windows-Pfad um.

## Aufbau

| Bereich | Ort |
| --- | --- |
| Seiten (je Werkzeug eine Route) | `src/app/` |
| Startseite, Kopfzeile, Marke | `src/components/pdfapp/` (Name/Texte: `brand.ts`) |
| Werkzeug-Oberflächen | `src/components/pdfapp/tools/` |
| PDF-Funktionen (pdf-lib) | `src/lib/pdf/operations.ts` |
| Übersetzung, OCR | `src/lib/pdf/translate/` |
| Offline-Dateien, Service Worker, App-Symbole | `scripts/` |

## Lizenzen

Der Code steht unter der MIT-Lizenz (siehe `LICENSE`; das Projektgerüst basiert auf
[ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template)).
Verwendete Bibliotheken, Modelle und Schriften sind in der App unter **„Lizenzen & Danksagungen“** aufgeführt –
u. a. pdf-lib (MIT), PDF.js (Apache-2.0), Tesseract.js (Apache-2.0), Opus-MT-Übersetzungsmodelle der Universität
Helsinki (CC BY 4.0), Transformers.js (Apache-2.0), Inter (SIL OFL 1.1) und DejaVu Sans.

Maschinelle Übersetzungen können Fehler enthalten.
