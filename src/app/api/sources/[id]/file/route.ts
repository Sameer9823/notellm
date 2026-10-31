import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { detectImageFormat } from "@/lib/extractors/image";

/**
 * Streams the original uploaded file (PDF or IMAGE) for a source back to the
 * browser, without a redirect. Used by `<PdfViewer>` and `<ImageViewer>` so the
 * original document can be rendered with full fidelity.
 *
 * Cloudinary URLs are fetched directly. Byte-range requests are forwarded
 * verbatim for PDFs; images ignore range headers. `Content-Type` is derived
 * from the file extension (Cloudinary) or sniffed from the magic bytes (local).
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

  // Only PDF and IMAGE sources with a stored original file can be served.
  // Other types (TEXT, URL, YOUTUBE, VTT, WEB) fall back to the chunk-text viewer.
  if (source.type !== "PDF" && source.type !== "IMAGE") {
    return new Response("No stored file for this source", { status: 404 });
  }

  const isImage = source.type === "IMAGE";

  // Local SourceFile fallback (Cloudinary not configured or upload failed)
  if (!source.storagePath) {
    if (!source.sourceFile?.data) {
      return new Response("No stored file for this source", { status: 404 });
    }
    const buf = Buffer.from(source.sourceFile.data);
    const contentType = isImage
      ? `image/${detectImageFormat(buf) ?? "jpeg"}`
      : "application/pdf";
    const ext = isImage ? (detectImageFormat(buf) ?? "jpg") : "pdf";
    return new Response(new Uint8Array(source.sourceFile.data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="source-${id}.${ext}"`,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(source.sourceFile.data.length),
      },
    });
  }

  // Cloudinary URLs are public and don't need presigning
  const downloadUrl = source.storagePath;

  if (isImage) {
    // Images: simple passthrough, no range support needed
    let upstream: Response;
    try {
      upstream = await fetch(downloadUrl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[sources/file] Upstream fetch failed for ${source.storagePath}`, err);
      return new Response("Bad Gateway", { status: 502 });
    }

    if (!upstream.ok) {
      return new Response("Bad Gateway", { status: 502 });
    }

    const outHeaders = new Headers();
    // Preserve Cloudinary's content type (image/jpeg, image/png, etc.)
    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
    outHeaders.set("Content-Type", ct);
    outHeaders.set("Content-Disposition", "inline");
    outHeaders.set("Cache-Control", "private, max-age=3600");
    const cl = upstream.headers.get("content-length");
    if (cl) outHeaders.set("Content-Length", cl);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  // PDF: range-request passthrough to pdf.js
  const range = req.headers.get("range");
  const init: RequestInit = {};
  if (range) init.headers = { Range: range };

  let upstream: Response;
  try {
    upstream = await fetch(downloadUrl, init);
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
  // 100MB) PDF into memory on the server.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}
