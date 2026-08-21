import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

function generateSlug() {
  // 9 random bytes -> 12-char base64url string, ~72 bits of entropy —
  // enough that a share link can't be guessed, short enough to paste.
  return randomBytes(9).toString("base64url");
}

// POST enables public sharing and returns the share URL. Reuses the
// existing shareSlug if this notebook has been shared before, so an old
// link a user already sent out keeps working after a revoke + re-share.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const notebook = await ownedNotebook(id, userId);
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  let slug = notebook.shareSlug;
  if (!slug) {
    // Extremely unlikely to collide given the entropy above, but retry
    // once on the off chance the unique constraint is hit.
    slug = generateSlug();
    try {
      await db.notebook.update({ where: { id }, data: { isPublic: true, shareSlug: slug } });
    } catch {
      slug = generateSlug();
      await db.notebook.update({ where: { id }, data: { isPublic: true, shareSlug: slug } });
    }
  } else {
    await db.notebook.update({ where: { id }, data: { isPublic: true } });
  }

  return NextResponse.json({ isPublic: true, shareSlug: slug });
}

// DELETE turns sharing off. The slug is kept (not cleared) so re-enabling
// later doesn't invalidate a link someone already has — see comment above.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  if (!(await ownedNotebook(id, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  await db.notebook.update({ where: { id }, data: { isPublic: false } });
  return NextResponse.json({ isPublic: false });
}