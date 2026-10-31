import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/notebooks/[id]/sources/route";
import type { SourceType } from "@/types";

const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00,
]);
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const { db, withTransaction, isTransientDbError, TRANSACTION_DEFAULTS } = vi.hoisted(() => {
  const db = {
    notebook: { findUnique: vi.fn(), update: vi.fn() },
    source: { create: vi.fn(), update: vi.fn().mockResolvedValue({ id: "src_test", status: "FAILED" }) },
    sourceFile: { create: vi.fn() },
    update: vi.fn(),
    $transaction: vi.fn(),
  };
  return { db, withTransaction: vi.fn(), isTransientDbError: vi.fn(), TRANSACTION_DEFAULTS: { maxWait: 10000, timeout: 30000 } };
});

const { setProgress } = vi.hoisted(() => ({
  setProgress: vi.fn(),
}));

const { safeSend } = vi.hoisted(() => ({
  safeSend: vi.fn(),
}));

const { checkRateLimit, rateLimitResponse, RATE_LIMITS } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { sourceUpload: { limit: 100, windowSec: 60 } },
}));

const { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } = vi.hoisted(() => ({
  consumeCredits: vi.fn(),
  creditsExhaustedResponse: vi.fn(),
  CREDIT_COSTS: { sourceUpload: 1 },
}));

const { cloudinaryEnabled, uploadBuffer } = vi.hoisted(() => ({
  cloudinaryEnabled: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db, withTransaction, isTransientDbError, TRANSACTION_DEFAULTS }));
vi.mock("@/lib/redis", () => ({ redis: {}, setProgress }));
vi.mock("@/lib/inngest/client", () => ({ inngest: {}, safeSend }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit, rateLimitResponse, RATE_LIMITS }));
vi.mock("@/lib/credits", () => ({ consumeCredits, creditsExhaustedResponse, CREDIT_COSTS }));
vi.mock("@/lib/cloudinary", () => ({ cloudinaryEnabled, uploadBuffer }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

function makeImageFile(name: string, buffer: Buffer): File {
  return new File([new Uint8Array(buffer)], name, { type: "image/jpeg" });
}

function makeJsonRequest(body: unknown): NextRequest {
  const json = JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/notebooks/nb_test/sources", {
    method: "POST",
    body: json,
    headers: { "Content-Type": "application/json" },
  });
}

function makeMultipart(file: File, type?: string): NextRequest {
  const form = new FormData();
  form.append("file", file);
  if (type) form.append("type", type);

  return new NextRequest("http://localhost:3000/api/notebooks/nb_test/sources", {
    method: "POST",
    body: form,
  });
}

function mockAuthenticated() {
  auth.mockReturnValue(Promise.resolve({ userId: "user_test" }));
}

function setupDefaults() {
  mockAuthenticated();
  db.notebook.findUnique.mockResolvedValue({ id: "nb_test", ownerId: "user_test" });
  db.source.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "src_test", ...args.data })
  );
  db.sourceFile.create.mockResolvedValue({ id: "sf_test" });
  db.update.mockResolvedValue({});
  setProgress.mockResolvedValue(null);
  safeSend.mockResolvedValue(true);
  checkRateLimit.mockResolvedValue({ allowed: true });
  consumeCredits.mockResolvedValue({ status: "ok", allowed: true });
  cloudinaryEnabled.mockReturnValue(false);
  creditsExhaustedResponse.mockReturnValue(new Response("{}", { status: 429 }));
}

describe("POST /api/notebooks/[id]/sources", () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.error = originalConsoleError;
  });

  describe("authorization & rate limiting", () => {
    it("returns 401 when not authenticated", async () => {
      auth.mockReturnValue(Promise.resolve({ userId: null }));
      const req = makeJsonRequest({ type: "TEXT", title: "test", content: "hello" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate-limited", async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 60 });
      rateLimitResponse.mockReturnValue(new Response("{}", { status: 429 }));
      const req = makeJsonRequest({ type: "TEXT", title: "test", content: "hello" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(429);
    });
  });

  describe("notebook ownership", () => {
    it("returns 404 when notebook not found", async () => {
      db.notebook.findUnique.mockResolvedValue(null);
      const req = makeJsonRequest({ type: "TEXT", title: "test", content: "hello" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(404);
    });

    it("returns 404 when notebook belongs to another user", async () => {
      db.notebook.findUnique.mockResolvedValue({ id: "nb_test", ownerId: "user_other" });
      const req = makeJsonRequest({ type: "TEXT", title: "test", content: "hello" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(404);
    });
  });

  describe("IMAGE source via JSON (Cloudinary direct-upload path)", () => {
    it("creates an IMAGE source with storagePath and storagePublicId", async () => {
      const req = makeJsonRequest({
        type: "IMAGE" as SourceType,
        title: "chart.jpg",
        fileSizeBytes: 1024,
        storagePath: "https://res.cloudinary.com/sthv3md8/image/upload/v123/footnote/sources/nb_test/abc123.jpg",
        storagePublicId: "footnote/sources/nb_test/abc123.jpg",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.source.type).toBe("IMAGE");
      expect(data.source.storagePath).toContain("cloudinary.com");
      expect(data.source.storagePublicId).toContain("nb_test");

      expect(db.source.create).toHaveBeenCalledWith({
        data: {
          notebookId: "nb_test",
          type: "IMAGE",
          title: "chart.jpg",
          status: "QUEUED",
          storagePath: expect.any(String),
          storagePublicId: expect.any(String),
          fileSizeBytes: 1024,
        },
      });
      expect(safeSend).toHaveBeenCalledWith({
        name: "source/created",
        data: { sourceId: "src_test" },
      });
    });

    it("rejects IMAGE with non-Cloudinary storagePath", async () => {
      const req = makeJsonRequest({
        type: "IMAGE",
        title: "chart.jpg",
        fileSizeBytes: 1024,
        storagePath: "https://evil.com/image.jpg",
        storagePublicId: "footnote/sources/nb_test/abc123.jpg",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
      expect(db.source.create).not.toHaveBeenCalled();
    });

    it("rejects IMAGE with storagePublicId not scoped to notebook", async () => {
      const req = makeJsonRequest({
        type: "IMAGE",
        title: "chart.jpg",
        fileSizeBytes: 1024,
        storagePath: "https://res.cloudinary.com/sthv3md8/image/upload/v123/abc.jpg",
        storagePublicId: "footnote/sources/other_notebook/abc123.jpg",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
    });

    it("rejects IMAGE with oversized fileSizeBytes", async () => {
      const req = makeJsonRequest({
        type: "IMAGE",
        title: "chart.jpg",
        fileSizeBytes: 50 * 1024 * 1024,
        storagePath: "https://res.cloudinary.com/sthv3md8/image/upload/v123/abc.jpg",
        storagePublicId: "footnote/sources/nb_test/abc.jpg",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
    });
  });

  describe("IMAGE source via multipart", () => {
    it("creates IMAGE source from multipart form upload", async () => {
      const file = makeImageFile("photo.png", PNG_MAGIC);
      const req = makeMultipart(file, "IMAGE");
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.source.type).toBe("IMAGE");
      expect(data.source.title).toBe("photo.png");
      expect(db.source.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "IMAGE",
            title: "photo.png",
            status: "QUEUED",
          }),
        })
      );
    });

    it("rejects multipart IMAGE with invalid extension", async () => {
      const file = makeImageFile("photo.gif", JPEG_MAGIC);
      const req = makeMultipart(file, "IMAGE");
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
      expect(db.source.create).not.toHaveBeenCalled();
    });

    it("rejects multipart IMAGE with unrecognized magic bytes", async () => {
      const file = new File([Buffer.from([0x00, 0x01, 0x02, 0x03])], "photo.jpg", {
        type: "image/jpeg",
      });
      const req = makeMultipart(file, "IMAGE");
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
    });

    it("rejects IMAGE file exceeding size limit", async () => {
      const file = new File([Buffer.concat([JPEG_MAGIC, Buffer.alloc(20 * 1024 * 1024)])], "big.jpg", {
        type: "image/jpeg",
      });
      const req = makeMultipart(file, "IMAGE");
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });
      expect(res.status).toBe(400);
    });

    it("creates SourceFile fallback when Cloudinary is not configured", async () => {
      cloudinaryEnabled.mockReturnValue(false);
      const file = makeImageFile("photo.jpg", JPEG_MAGIC);
      const req = makeMultipart(file, "IMAGE");
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      expect(db.sourceFile.create).toHaveBeenCalledWith({
        data: { sourceId: "src_test", data: expect.any(Buffer) },
      });
    });
  });

  describe("TEXT source via JSON", () => {
    it("creates a TEXT source", async () => {
      const req = makeJsonRequest({ type: "TEXT", title: "My Notes", content: "Some text content" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      expect(db.source.create).toHaveBeenCalledWith({
        data: {
          notebookId: "nb_test",
          type: "TEXT",
          title: "My Notes",
          status: "QUEUED",
          rawText: "Some text content",
        },
      });
    });
  });

  describe("URL and YOUTUBE sources via JSON", () => {
    it("creates a URL source", async () => {
      const req = makeJsonRequest({ type: "URL", url: "https://example.com/article" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      expect(db.source.create).toHaveBeenCalledWith({
        data: {
          notebookId: "nb_test",
          type: "URL",
          title: "https://example.com/article",
          status: "QUEUED",
          originUrl: "https://example.com/article",
        },
      });
    });

    it("creates a YOUTUBE source", async () => {
      const req = makeJsonRequest({ type: "YOUTUBE", url: "https://youtube.com/watch?v=dQw4w9WgXcQ" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      expect(db.source.create).toHaveBeenCalledWith({
        data: {
          notebookId: "nb_test",
          type: "YOUTUBE",
          title: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          status: "QUEUED",
          originUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        },
      });
    });
  });

  describe("enqueue failure handling", () => {
    it("marks source as FAILED when Inngest enqueue fails", async () => {
      safeSend.mockResolvedValue(false);
      const req = makeJsonRequest({ type: "TEXT", title: "test", content: "hello" });
      const res = await POST(req, { params: Promise.resolve({ id: "nb_test" }) });

      expect(res.status).toBe(201);
      expect(db.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        })
      );
    });
  });
});
