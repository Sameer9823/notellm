"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { SourceType } from "@/types";

/**
 * Shared source-submission logic. Originally lived inline inside
 * AddSourceDialog; pulled out so the sources rail's drag-and-drop can post
 * files the exact same way the dialog's FileDrop does, without duplicating
 * the fetch/toast/error handling.
 */
export function useAddSource(notebookId: string, onAdded: () => void) {
  const [submitting, setSubmitting] = useState(false);

  async function submitJson(body: object) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] || err.error || "Failed to add source");
      }
      toast.success("Source added — indexing now");
      onAdded();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /** PDFs and images go browser -> Cloudinary directly (Vercel rejects request
   *  bodies over ~4.5MB with a 413 before our route runs), then only the
   *  resulting URL is POSTed to our API. Falls back to the old multipart path
   *  when Cloudinary isn't configured (local dev) or for small VTT files.
   *  Uses SIGNED upload (no preset needed) - gets signature from our API. */
  async function uploadToCloudinaryDirect(file: File, resourceType: "raw" | "image"): Promise<Response | null> {
    const base = `/api/notebooks/${notebookId}/sources`;

    // Read NEXT_PUBLIC_ env vars (available in browser)
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;

    if (!cloudName || !apiKey) return null; // not configured -> caller falls back to multipart

    // Get signature from our API (uses server-side API secret)
    const folder = `footnote/sources/${notebookId}`;
    // public_id is just the UUID + extension — Cloudinary prepends `folder`
    // automatically, so including it here would double the path.
    const ext = file.name.substring(file.name.lastIndexOf("."));
    const publicId = `${crypto.randomUUID()}${ext}`;
    const sigRes = await fetch(
      `/api/cloudinary/upload-signature?folder=${encodeURIComponent(folder)}&resourceType=${encodeURIComponent(resourceType)}&publicId=${encodeURIComponent(publicId)}`
    );
    if (!sigRes.ok) {
      const err = await sigRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to get upload signature");
    }
    const { signature, timestamp, api_key } = await sigRes.json();

    const cloudForm = new FormData();
    cloudForm.append("file", file);
    cloudForm.append("api_key", api_key);
    cloudForm.append("timestamp", timestamp.toString());
    cloudForm.append("signature", signature);
    cloudForm.append("folder", folder);
    cloudForm.append("public_id", publicId);

    const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
      method: "POST",
      body: cloudForm,
    }).catch((err) => {
      throw new Error(`Network error uploading to Cloudinary: ${err.message}`);
    });
    const uploaded = await up.json().catch(() => null);
    if (!up.ok || !uploaded?.secure_url) {
      const cloudinaryError = uploaded?.error?.message ?? String(up.statusText);
      const lowered = cloudinaryError.toLowerCase();
      if (lowered.includes("size") || lowered.includes("too large") || up.status === 413) {
        throw new Error("File exceeds the storage limit on the current Cloudinary plan");
      }
      throw new Error(uploaded?.error?.message || `Upload to file storage failed (${up.status})`);
    }

    return fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: resourceType === "image" ? "IMAGE" : "PDF",
        title: file.name,
        fileSizeBytes: file.size,
        storagePath: uploaded.secure_url,
        storagePublicId: uploaded.public_id,
      }),
    });
  }

  async function submitFile(file: File, type: Extract<SourceType, "PDF" | "VTT" | "IMAGE">) {
    setSubmitting(true);
    try {
      let res: Response | null = null;
      if (type === "PDF" || type === "IMAGE") {
        const resourceType = type === "IMAGE" ? "image" : "raw";
        res = await uploadToCloudinaryDirect(file, resourceType);
      }

      if (!res) {
        // In production, PDFs/images larger than ~4MB REQUIRE the Cloudinary
        // direct-upload path — Vercel rejects multipart request bodies over
        // the platform limit with a 413 before our route handler even runs.
        // Only fall back to the multipart path for small files or local dev.
        const largeAndNeedsCloudinary = (type === "PDF" || type === "IMAGE") && file.size > 4 * 1024 * 1024;
        if (largeAndNeedsCloudinary) {
          throw new Error(
            "Cloudinary isn't configured on this deployment: set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and " +
              "NEXT_PUBLIC_CLOUDINARY_API_KEY so large files upload directly."
          );
        }
        const form = new FormData();
        form.append("file", file);
        form.append("type", type);
        res = await fetch(`/api/notebooks/${notebookId}/sources`, { method: "POST", body: form });
      }

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error("File is too large to upload. Configure Cloudinary so large files can upload directly.");
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] || err.error || "Failed to upload file");
      }
      const result = await res.json();
      if (result.warning) {
        toast.warning(result.warning);
      }
      toast.success("Source uploaded — indexing now");
      onAdded();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /** Guesses source type from a dropped file's extension/MIME so drag-and-drop
   *  onto the rail (which has no type picker) can still call submitFile. */
  function inferFileType(file: File): Extract<SourceType, "PDF" | "VTT" | "IMAGE"> | null {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") return "PDF";
    if (name.endsWith(".vtt") || name.endsWith(".srt") || name.endsWith(".txt")) return "VTT";
    if (
      name.endsWith(".jpg") || name.endsWith(".jpeg") ||
      name.endsWith(".png") || name.endsWith(".webp") ||
      file.type.startsWith("image/")
    ) {
      return "IMAGE";
    }
    return null;
  }

  return { submitting, submitJson, submitFile, inferFileType };
}
