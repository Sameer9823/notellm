import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

/**
 * Streams the original uploaded file (PDF) for a source back to the browser,
 * without a redirect. Used by `<PdfViewer>` so pdf.js can render the
 * *original* document and deep-link to an exact page — the chunk-text view
 * in `/content` is great for search results but loses page layout/fidelity.
 *
 * Cloudinary raw URLs have no .pdf extension and report a generic content
 * type, so we hard-set `Content-Type: application/pdf` regardless of what
 * the upstream returns. Byte-range requests are forwarded verbatim so the
 * viewer can page-flip lazily; `Content-Range`/`Content-Length` from the
 * upstream are passed through untouched.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const source = await db.source.findUnique({
    where: { id },
    select: {
      type: true,
      storagePath: true,
      notebook: { select: { ownerId: true } },
      sourceFile: { select: { data: true } },
    },
  });

  if (!source || source.notebook.ownerId !== userId) {
    return new Response("Not found", { status: 404 });
  }

  // Only PDF sources with a stored original file can be served. Old PDFs
  // (no Cloudinary) and non-PDF types fall back to the chunk-text viewer.
  if (source.type !== "PDF") {
    return new Response("No stored file for this source", { status: 404 });
  }

  // Prefer the Cloudinary-hosted original (storagePath) when present; fall
  // back to the SourceFile table for PDFs stored locally (Cloudinary not
  // configured or upload failed).
  if (!source.storagePath) {
    if (!source.sourceFile?.data) {
      return new Response("No stored file for this source", { status: 404 });
    }
    return new Response(new Uint8Array(source.sourceFile.data), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="source-${id}.pdf"`,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(source.sourceFile.data.length),
      },
    });
  }

  const range = req.headers.get("range");
  const init: RequestInit = {};
  if (range) init.headers = { Range: range };

  let upstream: Response;
  try {
    upstream = await fetch(source.storagePath, init);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sources/file] Upstream fetch failed for ${source.storagePath}`, err);
    return new Response("Bad Gateway", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Bad Gateway", { status: 502 });
  }

  const outHeaders = new Headers();
  outHeaders.set("Content-Type", "application/pdf");
  outHeaders.set("Content-Disposition", "inline");
  outHeaders.set("Accept-Ranges", "bytes");
  outHeaders.set("Cache-Control", "private, max-age=3600");

  const cr = upstream.headers.get("content-range");
  if (cr) outHeaders.set("Content-Range", cr);
  const cl = upstream.headers.get("content-length");
  if (cl) outHeaders.set("Content-Length", cl);
  const accept = upstream.headers.get("accept-ranges");
  if (accept) outHeaders.set("Accept-Ranges", accept);

  // Stream the upstream body straight through — no buffering of the (up to
  // 25MB) PDF into memory on the server.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}
