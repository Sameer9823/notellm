import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signUpload } from "@/lib/cloudinary";

describe("signUpload", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when Cloudinary is not configured", () => {
    process.env.CLOUDINARY_CLOUD_NAME = undefined;
    process.env.CLOUDINARY_API_KEY = undefined;
    process.env.CLOUDINARY_API_SECRET = undefined;

    // Re-import to pick up the new env
    return import("@/lib/env").then(() => {
      expect(() => signUpload({ folder: "test" })).toThrow("Cloudinary isn't configured");
    });
  });
});

describe("signUpload with config", () => {
  it("returns a valid signature payload with required fields", () => {
    vi.doMock("@/lib/env", () => ({
      serverEnv: {
        cloudinary: {
          enabled: true,
          cloudName: "test-cloud",
          apiKey: "123456789",
          apiSecret: "shhh-secret",
        },
        isProduction: false,
      },
    }));

    return import("@/lib/cloudinary").then(({ signUpload }) => {
      const result = signUpload({ folder: "footnote/sources/abc123" });

      expect(result.cloudName).toBe("test-cloud");
      expect(result.apiKey).toBe("123456789");
      expect(result.folder).toBe("footnote/sources/abc123");
      expect(result.resourceType).toBe("raw");
      expect(result.signature).toMatch(/^[a-f0-9]{40}$/);
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });

  it("includes public_id in the signature when provided", () => {
    vi.doMock("@/lib/env", () => ({
      serverEnv: {
        cloudinary: {
          enabled: true,
          cloudName: "test-cloud",
          apiKey: "123456789",
          apiSecret: "shhh-secret",
        },
        isProduction: false,
      },
    }));

    return import("@/lib/cloudinary").then(({ signUpload }) => {
      const result = signUpload({ folder: "footnote/uploads", publicId: "my-file-123" });

      // The signature should differ from a call without publicId
      const resultNoPid = signUpload({ folder: "footnote/uploads" });

      expect(result.signature).not.toBe(resultNoPid.signature);
    });
  });

  it("uses provided resourceType", () => {
    vi.doMock("@/lib/env", () => ({
      serverEnv: {
        cloudinary: {
          enabled: true,
          cloudName: "test-cloud",
          apiKey: "123456789",
          apiSecret: "shhh-secret",
        },
        isProduction: false,
      },
    }));

    return import("@/lib/cloudinary").then(({ signUpload }) => {
      const result = signUpload({ folder: "footnote/audio", resourceType: "video" });
      expect(result.resourceType).toBe("video");
    });
  });
});
