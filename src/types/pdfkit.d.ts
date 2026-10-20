declare module "pdfkit" {
  export interface PDFDocumentOptions {
    margin?: number | { top: number; bottom: number; left: number; right: number };
    size?: string | [number, number];
    layout?: "portrait" | "landscape";
    bufferPages?: boolean;
    info?: {
      Title?: string;
      Author?: string;
      Subject?: string;
      Keywords?: string;
      Creator?: string;
      Producer?: string;
      CreationDate?: Date;
      ModDate?: Date;
    };
  }

  export interface PDFTextOptions {
    width?: number;
    height?: number;
    align?: "left" | "center" | "right" | "justify";
    indent?: number;
    paragraphGap?: number;
    lineGap?: number;
    continued?: boolean;
    features?: string[];
    link?: string;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    opacity?: number;
    bold?: boolean;
    italic?: boolean;
  }

  export interface PDFWidthOfStringOptions {
    font?: string | unknown;
    fontSize?: number;
    features?: string[];
  }

  export interface PDFDocument extends NodeJS.WritableStream {
    registerFont(name: string, src: string | Uint8Array | ArrayBuffer | { layout: (text: string) => unknown }, family?: string): this;
    font(src: string, family?: string, size?: number): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(text: string, x?: number, y?: number, options?: PDFTextOptions): this;
    text(text: string, options?: PDFTextOptions): this;
    widthOfString(text: string, options?: PDFWidthOfStringOptions): number;
    moveDown(lines?: number): this;
    addPage(options?: { size?: string; layout?: string; margin?: number }): this;
    link(x: number, y: number, width: number, height: number, url: string): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    stroke(color?: string): this;
    lineWidth(width: number): this;
    fillAndStroke(fillColor: string, strokeColor: string): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    circle(x: number, y: number, r: number): this;
    ellipse(x: number, y: number, r1: number, r2: number): this;
    roundedRect(x: number, y: number, width: number, height: number, radius: number): this;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): this;
    end(): void;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    switchToPage(pageNumber: number): this;
    bufferedPageRange(): { start: number; count: number };
    save(): this;
    restore(): this;
    restore(): this;
    x: number;
    y: number;
    pageSize: { width: number; height: number };
    pageMargins: { top: number; bottom: number; left: number; right: number };
  }

  const PDFDocument: { new (options?: PDFDocumentOptions): PDFDocument };
  export default PDFDocument;
}
