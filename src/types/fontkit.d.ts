declare module "fontkit" {
  export interface Font {
    layout(text: string): unknown;
    getVariation(settings: Record<string, number> | string): Font;
    family?: string;
    coords?: Record<string, number>;
    fvar?: { axis: { axisTag: string; minValue: number; maxValue: number; defaultValue: number }[] };
  }
  export function create(buf: Uint8Array | ArrayBuffer, postScriptName?: string): Font;
  export default { create };
}