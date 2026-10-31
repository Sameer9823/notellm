import { describe, it, expect } from "vitest";
import {
  isValidImageExtension,
  isValidImageMimeType,
  detectImageFormat,
  validateImageBuffer,
  MAX_IMAGE_BYTES,
} from "@/lib/extractors/image";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_MAGIC = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8, 0),
]);
// RIFF....WEBP
const WEBP_MAGIC = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.alloc(4, 0), // file size placeholder
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP
]);

describe("isValidImageExtension", () => {
  it("accepts jpg, jpeg, png, webp extensions", () => {
    expect(isValidImageExtension("photo.jpg")).toBe(true);
    expect(isValidImageExtension("photo.jpeg")).toBe(true);
    expect(isValidImageExtension("photo.png")).toBe(true);
    expect(isValidImageExtension("photo.webp")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isValidImageExtension("PHOTO.JPG")).toBe(true);
    expect(isValidImageExtension("Photo.PNG")).toBe(true);
  });

  it("rejects non-image extensions", () => {
    expect(isValidImageExtension("doc.pdf")).toBe(false);
    expect(isValidImageExtension("script.js")).toBe(false);
    expect(isValidImageExtension("video.mp4")).toBe(false);
  });
});

describe("isValidImageMimeType", () => {
  it("accepts standard image MIME types", () => {
    expect(isValidImageMimeType("image/jpeg")).toBe(true);
    expect(isValidImageMimeType("image/png")).toBe(true);
    expect(isValidImageMimeType("image/webp")).toBe(true);
  });

  it("rejects non-image MIME types", () => {
    expect(isValidImageMimeType("application/pdf")).toBe(false);
    expect(isValidImageMimeType("text/plain")).toBe(false);
    expect(isValidImageMimeType("image/gif")).toBe(false);
  });
});

describe("detectImageFormat", () => {
  it("detects JPEG from magic bytes", () => {
    expect(detectImageFormat(JPEG_MAGIC)).toBe("jpg");
  });

  it("detects PNG from magic bytes", () => {
    expect(detectImageFormat(PNG_MAGIC)).toBe("png");
  });

  it("detects WebP from magic bytes", () => {
    expect(detectImageFormat(WEBP_MAGIC)).toBe("webp");
  });

  it("returns null for empty buffer", () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBe(null);
  });

  it("returns null for non-image buffer", () => {
    expect(detectImageFormat(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe(null);
  });

  it("returns null for truncated RIFF without WEBP marker", () => {
    const truncated = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF only, no WEBP
    expect(detectImageFormat(truncated)).toBe(null);
  });
});

describe("validateImageBuffer", () => {
  it("accepts a valid JPEG under the size limit", () => {
    const buffer = Buffer.concat([JPEG_MAGIC, Buffer.alloc(100)]);
    const result = validateImageBuffer(buffer);
    expect(result).toEqual({ valid: true, format: "jpg" });
  });

  it("rejects an oversized buffer", () => {
    const buffer = Buffer.concat([JPEG_MAGIC, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    const result = validateImageBuffer(buffer);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("exceeds");
  });

  it("rejects an empty buffer", () => {
    const result = validateImageBuffer(Buffer.alloc(0));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("File is empty");
  });

  it("rejects a buffer with unrecognized magic bytes", () => {
    const result = validateImageBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Unrecognized image format");
  });
});
