import crypto from "crypto";
import { serverEnv } from "@/lib/env";

/**
 * Thin Cloudinary REST wrapper — same "raw fetch, no vendor SDK" style as
 * lib/tavily.ts and lib/extractors/firecrawl.ts, rather than pulling in
 * the `cloudinary` npm package for what's really two endpoints.
 *
 * Used to move large binary blobs out of Postgres:
 *  - Original PDF uploads (Source.storagePath / storagePublicId) — replaces
 *    the old approach of base64-encoding the whole file into the `rawText`
 *    text column just to hand it to the ingest pipeline.
 *  - Generated podcast MP3s (AudioOverview.audioUrl / audioPublicId) —
 *    replaces storing the raw MP3 bytes in the `audioData` Bytes column.
 *
 * Both call sites check `cloudinaryEnabled()` first and fall back to the
 * original in-Postgres behavior when no credentials are configured, so
 * this is a strict opt-in — nothing breaks for existing deployments.
 */

export type CloudinaryResourceType = "image" | "video" | "raw";

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  bytes: number;
};

/** Signature payload returned to the client for direct (unsigned-proxy) uploads.
 *  The client calls `POST https://api.cloudinary.com/v1_1/<cloud>/<type>/upload`
 *  with these fields plus the `file` blob. */
export type CloudinarySignature = {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  resourceType: CloudinaryResourceType;
};

export function cloudinaryEnabled(): boolean {
  return serverEnv.cloudinary.enabled;
}

function requireConfig() {
  const { cloudName, apiKey, apiSecret } = serverEnv.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary isn't configured (missing CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)");
  }
  return { cloudName, apiKey, apiSecret };
}

/** Cloudinary signed uploads require every non-file param (minus `file`,
 *  `api_key`, and `signature` itself) to be joined `key=value` pairs,
 *  alpha-sorted by key, then SHA1'd with the API secret appended. */
function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(sorted + apiSecret).digest("hex");
}

/**
 * Generates a signed upload payload for client-side direct-to-Cloudinary uploads.
 * The client posts its file (plus the returned signature/timestamp/apiKey/cloudName)
 * directly to Cloudinary — the API secret never touches the browser.
 */
export function signUpload(params: {
  folder: string;
  resourceType?: CloudinaryResourceType;
  publicId?: string;
}): CloudinarySignature {
  const { cloudName, apiKey, apiSecret } = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);

  const signParamsObj: Record<string, string | number> = {
    folder: params.folder,
    timestamp,
  };
  if (params.publicId) signParamsObj.public_id = params.publicId;
  const signature = signParams(signParamsObj, apiSecret);

  return {
    timestamp,
    signature,
    apiKey,
    cloudName,
    folder: params.folder,
    resourceType: params.resourceType ?? "raw",
  };
}
/**
 * Uploads a buffer to Cloudinary under the given resource type and folder.
 * `resourceType` should be "raw" for arbitrary files (PDFs, VTTs) and
 * "video" for audio (Cloudinary treats audio formats under the video
 * pipeline — there's no separate "audio" resource type).
 */
export async function uploadBuffer(
  buffer: Buffer,
  opts: { resourceType: CloudinaryResourceType; folder: string; publicId?: string; filename?: string }
): Promise<CloudinaryUploadResult> {
  const { cloudName, apiKey, apiSecret } = requireConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const signParamsObj: Record<string, string | number> = { folder: opts.folder, timestamp };
  if (opts.publicId) signParamsObj.public_id = opts.publicId;
  const signature = signParams(signParamsObj, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), opts.filename ?? "upload");
  form.append("folder", opts.folder);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  if (opts.publicId) form.append("public_id", opts.publicId);

  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${opts.resourceType}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Cloudinary upload request failed — ${cause}`);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.secure_url) {
    throw new Error(`Cloudinary upload failed${json?.error?.message ? ` — ${json.error.message}` : ` (${res.status})`}`);
  }

  return { url: json.secure_url as string, publicId: json.public_id as string, bytes: json.bytes as number };
}

/** Deletes a previously-uploaded asset. Best-effort — callers should treat
 *  failures as non-fatal (an orphaned Cloudinary asset costs storage, not
 *  correctness) and never let this block a DB row deletion. */
export async function destroyAsset(publicId: string, resourceType: CloudinaryResourceType): Promise<void> {
  const { cloudName, apiKey, apiSecret } = requireConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, apiSecret);

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Cloudinary destroy failed${body?.error?.message ? ` — ${body.error.message}` : ` (${res.status})`}`);
  }
}