import fs from "node:fs";
import path from "node:path";
import { create, Font as FontkitFont } from "fontkit";

let _regular: FontkitFont | null = null;
let _bold: FontkitFont | null = null;

function fontPath(): string {
  return path.resolve(process.cwd(), "public", "fonts", "inter", "Inter-VF.ttf");
}

function loadBase(): FontkitFont {
  if (_regular) return _regular;
  const buf = fs.readFileSync(fontPath());
  _regular = create(buf as unknown as Uint8Array);
  return _regular;
}

export function interRegular(): FontkitFont {
  return loadBase();
}

export function interBold(): FontkitFont {
  if (_bold) return _bold;
  _bold = loadBase().getVariation({ wght: 700 });
  return _bold;
}

export function registerInterFonts(doc: { registerFont(name: string, src: FontkitFont): void }): void {
  doc.registerFont("Inter", interRegular());
  doc.registerFont("Inter-Bold", interBold());
}