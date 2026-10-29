import {
  Combine,
  Crop,
  Hash,
  Image,
  Languages,
  LayoutGrid,
  RotateCw,
  Scissors,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type ToolCategory = "organize" | "edit" | "convert" | "intelligence";

export interface ToolInfo {
  href: string;
  title: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  /** icon tile colors */
  color: string;
  isNew?: boolean;
}

export const TOOLS: ToolInfo[] = [
  {
    href: "/pdf-ubersetzen/",
    title: "PDF übersetzen",
    description: "Ganze Dokumente übersetzen – das Layout bleibt erhalten. Auch für eingescannte Seiten, komplett offline.",
    category: "intelligence",
    icon: Languages,
    color: "#7c3aed",
    isNew: true,
  },
  {
    href: "/pdf_zusammenfuegen/",
    title: "PDFs zusammenfügen",
    description: "Mehrere PDFs zu einer Datei verbinden und die Reihenfolge per Drag & Drop festlegen.",
    category: "organize",
    icon: Combine,
    color: "#4f46e5",
  },
  {
    href: "/pdf_teilen/",
    title: "PDF teilen",
    description: "Seitenbereiche abtrennen oder einzelne Seiten als eigene PDFs speichern.",
    category: "organize",
    icon: Scissors,
    color: "#4f46e5",
  },
  {
    href: "/pdf-seiten-loschen/",
    title: "Seiten entfernen",
    description: "Unnötige Seiten anklicken und ohne sie neu speichern.",
    category: "organize",
    icon: Trash2,
    color: "#4f46e5",
  },
  {
    href: "/organisieren-pdf/",
    title: "PDF organisieren",
    description: "Seiten sortieren, drehen und löschen – auch über mehrere Dateien hinweg.",
    category: "organize",
    icon: LayoutGrid,
    color: "#4f46e5",
  },
  {
    href: "/drehen_pdf/",
    title: "PDF drehen",
    description: "Ganze Dokumente nach links oder rechts drehen, mehrere Dateien auf einmal.",
    category: "edit",
    icon: RotateCw,
    color: "#0d9488",
  },
  {
    href: "/pdf_seitenzahlen/",
    title: "Seitenzahlen",
    description: "Seitenzahlen mit frei wählbarer Position, Größe und Schreibweise einfügen.",
    category: "edit",
    icon: Hash,
    color: "#0d9488",
  },
  {
    href: "/pdf_wasserzeichen/",
    title: "Wasserzeichen",
    description: "Text oder Bild als Wasserzeichen platzieren – mit Transparenz, Drehung und Mosaik.",
    category: "edit",
    icon: Stamp,
    color: "#0d9488",
  },
  {
    href: "/pdf-zuschneiden/",
    title: "PDF zuschneiden",
    description: "Ränder entfernen oder einen Bereich auswählen, der erhalten bleiben soll.",
    category: "edit",
    icon: Crop,
    color: "#0d9488",
  },
  {
    href: "/jpg_zu_pdf/",
    title: "Bilder in PDF",
    description: "JPG, PNG und andere Bilder in ein PDF umwandeln – mit Seitengröße und Rand nach Wahl.",
    category: "convert",
    icon: Image,
    color: "#d97706",
  },
];

export const CATEGORY_FILTERS: { id: "all" | ToolCategory; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "intelligence", label: "Übersetzen" },
  { id: "organize", label: "Organisieren" },
  { id: "edit", label: "Bearbeiten" },
  { id: "convert", label: "Umwandeln" },
];

export const toolByHref = (href: string) => TOOLS.find((t) => t.href === href);
