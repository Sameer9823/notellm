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
      api_key: "123456789012345",
      cloudName: "test-cloud",
      folder: "footnote/sources/test-notebook",
      resourceType: "raw",
    });
    expect(typeof result.timestamp).toBe("number");
    expect(typeof result.signature).toBe("string");
    expect(result.signature.length).toBe(40); // SHA1 hex
  });

  it("includes public_id in the signed string when provided", async () => {
    const { signUpload } = await import("@/lib/cloudinary");
    const result = signUpload({
      folder: "footnote/sources/test-notebook",
      publicId: "abc-123.pdf",
    });

    // Re-implement the signing algorithm to verify the signature is reproducible
    // when public_id is included — proving it was part of the signed payload.
    const crypto = await import("crypto");
    const secret = "abcdefghijklmnopqrstuvwxyz12";
    const params = { folder: "footnote/sources/test-notebook", public_id: "abc-123.pdf", timestamp: result.timestamp };
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k as keyof typeof params]}`)
      .join("&");
    const expected = crypto.createHash("sha1").update(sorted + secret).digest("hex");

    expect(result.signature).toBe(expected);

    // And verify it differs from the signature without public_id.
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