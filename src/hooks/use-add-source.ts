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

  /** PDFs go browser -> Cloudinary directly (Vercel rejects request bodies
   *  over ~4.5MB with a 413 before our route runs), then only the resulting
   *  URL is POSTed to our API. Falls back to the old multipart path when
   *  Cloudinary isn't configured (local dev) or for small VTT files. */
  async function uploadPdfDirect(file: File): Promise<Response | null> {
    const base = `/api/notebooks/${notebookId}/sources`;

    // Read NEXT_PUBLIC_ env vars (available in browser)
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "ml_default";

    if (!cloudName) return null; // not configured -> caller falls back to multipart

    // Build a unique public_id including the extension.
    // ml_default has "Use filename: true" and "Unique filename: false",
    // so without an explicit public_id, two uploads with the same filename
    // would collide and Cloudinary would return the FIRST file's URL.
    const publicId = `footnote/sources/${notebookId}/${crypto.randomUUID()}.pdf`;
    const assetFolder = `footnote/sources/${notebookId}`;

    const cloudForm = new FormData();
    cloudForm.append("file", file);
    cloudForm.append("upload_preset", uploadPreset);
    cloudForm.append("public_id", publicId);
    cloudForm.append("asset_folder", assetFolder);

    const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
      method: "POST",
      body: cloudForm,
    });
    const uploaded = await up.json().catch(() => null);
    if (!up.ok || !uploaded?.secure_url) {
      throw new Error(uploaded?.error?.message || "Upload to file storage failed");
    }

    // Debug: log what Cloudinary returned
    console.debug("[uploadPdfDirect] Cloudinary response:", {
      secure_url: uploaded.secure_url,
      public_id: uploaded.public_id,
      expectedPublicId: publicId,
    });

    return fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "PDF",
        title: file.name,
        fileSizeBytes: file.size,
        storagePath: uploaded.secure_url,
        storagePublicId: uploaded.public_id,
      }),
    });
  }

  async function submitFile(file: File, type: Extract<SourceType, "PDF" | "VTT">) {
    setSubmitting(true);
    try {
      let res: Response | null = null;
      if (type === "PDF") res = await uploadPdfDirect(file);

      if (!res) {
        const form = new FormData();
        form.append("file", file);
        form.append("type", type);
        res = await fetch(`/api/notebooks/${notebookId}/sources`, { method: "POST", body: form });
      }

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error("File is too large to upload. Configure Cloudinary so large PDFs can upload directly.");
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
  function inferFileType(file: File): Extract<SourceType, "PDF" | "VTT"> | null {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") return "PDF";
    if (name.endsWith(".vtt") || name.endsWith(".srt") || name.endsWith(".txt")) return "VTT";
    return null;
  }

  return { submitting, submitJson, submitFile, inferFileType };
}