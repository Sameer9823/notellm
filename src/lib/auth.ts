import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Resolves the current Clerk user id or throws a 401-shaped error the
 *  route handlers can catch and return directly. */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return userId;
}

/** Loads a notebook and verifies the current user owns it. Notebook
 *  isolation is enforced here, at the data layer, not just in the UI. */
export async function requireNotebookOwnership(notebookId: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    throw NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }
  return notebook;
}
