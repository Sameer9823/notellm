import type { z } from "zod";

export interface ServerTool<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TParams;
  sideEffects: boolean;
  execute(args: z.infer<TParams>): Promise<string>;
}

export type ToolResult = { ok: true; result: string } | { ok: false; error: string };
