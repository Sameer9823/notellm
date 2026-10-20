// src/lib/export/fonts.ts
// Static Inter TTFs (NOT the variable font): pdfkit cannot subset variable-font
// instances (getVariation) and crashes with "First argument to DataView constructor...".
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "public", "fonts", "inter");

function load(file: string): Buffer | null {
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? Buffer.from(fs.readFileSync(p)) : null; // always a real Node Buffer
}

export function registerInterFonts(doc: { registerFont(name: string, src: Buffer): unknown }): void {
  const regular = load("Inter-Regular.ttf");
  const bold = load("Inter-Bold.ttf");
  if (!regular || !bold) throw new Error(`Missing Inter-Regular.ttf / Inter-Bold.ttf in ${DIR}`);
  doc.registerFont("Inter", regular);
  doc.registerFont("Inter-Bold", bold);
  const italic = load("Inter-Italic.ttf");
  if (italic) doc.registerFont("Inter-Italic", italic);
}