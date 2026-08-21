declare module "node-webvtt" {
  export interface WebVttCue {
    identifier: string;
    start: number;
    end: number;
    text: string;
    styles?: string;
  }
  export interface WebVttParseResult {
    valid: boolean;
    strict: boolean;
    cues: WebVttCue[];
    errors: unknown[];
  }
  export function parse(input: string, options?: { strict?: boolean }): WebVttParseResult;
  export function compile(input: { valid: boolean; cues: WebVttCue[] }): string;
  const _default: { parse: typeof parse; compile: typeof compile };
  export default _default;
}
