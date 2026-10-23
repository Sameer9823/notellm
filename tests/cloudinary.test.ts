import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("signUpload", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CLOUDINARY_CLOUD_NAME: "test-cloud",
      CLOUDINARY_API_KEY: "123456789012345",
      CLOUDINARY_API_SECRET: "abcdefghijklmnopqrstuvwxyz12",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("generates a valid signature payload", async () => {
    const { signUpload } = await import("@/lib/cloudinary");
    const result = signUpload({ folder: "footnote/sources/test-notebook" });

    expect(result).toMatchObject({
      apiKey: "123456789012345",
      cloudName: "test-cloud",
      folder: "footnote/sources/test-notebook",
      resourceType: "raw",
    });
    expect(typeof result.timestamp).toBe("number");
    expect(typeof result.signature).toBe("string");
    expect(result.signature.length).toBe(40); // SHA1 hex
  });

  it("includes public_id when provided", async () => {
    const { signUpload } = await import("@/lib/cloudinary");
    const result = signUpload({
      folder: "footnote/sources/test-notebook",
      publicId: "custom-id",
    });

    // The signature should be different when public_id is included
    const resultWithout = signUpload({ folder: "footnote/sources/test-notebook" });
    expect(result.signature).not.toBe(resultWithout.signature);
  });

  it("throws when Cloudinary is not configured", async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.CLOUDINARY_CLOUD_NAME;

    const { signUpload } = await import("@/lib/cloudinary");
    expect(() => signUpload({ folder: "footnote/sources/test" })).toThrow(
      "Cloudinary isn't configured"
    );
  });
});