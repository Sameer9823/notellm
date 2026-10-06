import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyToolToken } from "@/lib/voice/server-config";
import { createSearchNotebookTool, TOOL_NAMES } from "@/lib/voice/tools/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const argsSchema = z.object({ query: z.string().min(1).max(300) });

function toolRefused(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { userId } = await auth();
  if (!userId) return toolRefused(401, "Unauthorized");

  const toolToken = req.headers.get("x-voice-tool-token");
  if (!toolToken) return toolRefused(401, "Missing tool token");

  const verified = verifyToolToken(toolToken);
  if (!verified) return toolRefused(401, "Invalid or expired tool token");

  const { userId: tokenUserId, notebookId, sessionId } = verified.payload as {
    userId: string;
    notebookId: string;
    sessionId: string;
    exp: number;
  };

  if (tokenUserId !== userId) return toolRefused(403, "Tool token is not for this user");

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return toolRefused(403, "Notebook not found or not owned by you");
  }

  const { name } = await params;
  if (!TOOL_NAMES.includes(name as string)) return toolRefused(404, `No tool named "${name}"`);

  let raw: unknown = {};
  try {
    const text = await req.text();
    if (text) raw = JSON.parse(text);
  } catch {
    return toolRefused(400, "Could not read tool arguments.");
  }

  const parsed = argsSchema.safeParse(raw);
  if (!parsed.success) {
    return toolRefused(400, `The query argument is missing or invalid.`);
  }

  try {
    const tool = createSearchNotebookTool(notebookId);
    const result = await tool.execute(parsed.data);
    console.log(`[voice/tools/${name}] notebookId=${notebookId} resultLen=${String(result).length}`);
    return NextResponse.json({ ok: true, result, sessionId });
  } catch (err) {
    console.error(`[voice/tools/${name}] threw:`, err);
    return toolRefused(500, `The ${name.replace(/_/g, " ")} tool failed. Please try again.`);
  }
}
