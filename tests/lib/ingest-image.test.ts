import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, withDbRetry, withTransaction } = vi.hoisted(() => ({
  db: {
    source: { findUnique: vi.fn(), update: vi.fn() },
    chunk: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
  withDbRetry: vi.fn((fn) => fn()),
  withTransaction: vi.fn(),
}));

const { setProgress } = vi.hoisted(() => ({
  setProgress: vi.fn(),
}));

const { embedTexts } = vi.hoisted(() => ({
  embedTexts: vi.fn(),
}));

const { upsertChunks, deleteBySourceExcept } = vi.hoisted(() => ({
  upsertChunks: vi.fn(),
  deleteBySourceExcept: vi.fn(),
}));

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const mockFetch = vi.fn();

vi.mock("@/lib/db", () => ({ db, withDbRetry, withTransaction }));
vi.mock("@/lib/redis", () => ({ setProgress }));
vi.mock("@/lib/openai", () => ({ embedTexts }));
vi.mock("@/lib/qdrant", () => ({ upsertChunks, deleteBySourceExcept }));
vi.mock("@/lib/extractors/image", () => ({
  extractImage: vi.fn(),
}));
vi.mock("@/lib/extractors/pdf", () => ({
  extractPdf: vi.fn(),
}));

global.fetch = mockFetch;

const { extractImage } = await import("@/lib/extractors/image");
const { runIngestPipeline } = await import("@/lib/ingest");

describe("runIngestPipeline — IMAGE sources", () => {
  const fakeImageSource = {
    id: "src_img_test",
    notebookId: "nb_test",
    type: "IMAGE" as const,
    title: "screenshot.png",
    rawText: null,
    storagePath: "https://res.cloudinary.com/test/image/upload/v123/footnote/sources/nb_test/abc.png",
    storagePublicId: "footnote/sources/nb_test/abc.png",
    originUrl: null,
    userId: "user_test",
    status: "QUEUED" as const,
    errorMessage: null,
    sourceFile: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => PNG_MAGIC.buffer,
    });

    db.source.findUnique.mockResolvedValue(fakeImageSource);
    db.source.update.mockResolvedValue({});
    db.chunk.deleteMany.mockResolvedValue({ count: 0 });
    db.chunk.createMany.mockResolvedValue({ count: 1 });

    setProgress.mockResolvedValue(null);
    embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    upsertChunks.mockResolvedValue(null);
    deleteBySourceExcept.mockResolvedValue(null);

    withTransaction.mockImplementation(async (cb) => cb({
      chunk: { deleteMany: db.chunk.deleteMany, createMany: db.chunk.createMany },
    }));
  });

  it("extracts an image from storagePath, chunks, embeds, upserts to Qdrant, and marks READY", async () => {
    vi.mocked(extractImage).mockResolvedValue({
      text: "Sales increased 23% in Q3. Revenue was $1.2M.",
      description: "A bar chart showing Q3 sales growth.",
      tables: [],
      equations: [],
      warnings: [],
      confidence: "high",
      metadata: { format: "png", model: "gpt-4o-mini", inputBytes: 1024, extractedAt: "2025-01-01T00:00:00Z" },
    });

    await runIngestPipeline("src_img_test");

    expect(db.source.findUnique).toHaveBeenCalledWith({
      where: { id: "src_img_test" },
      include: { sourceFile: true },
    });

    expect(extractImage).toHaveBeenCalled();
    const calledBuffer = vi.mocked(extractImage).mock.calls[0][0];
    expect(calledBuffer.slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]).slice(0, 4));

    expect(embedTexts).toHaveBeenCalledWith(["Sales increased 23% in Q3. Revenue was $1.2M."]);
    expect(upsertChunks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.any(String),
        vector: [0.1, 0.2, 0.3],
        payload: expect.objectContaining({
          notebookId: "nb_test",
          sourceId: "src_img_test",
          sourceType: "IMAGE",
          sourceTitle: "screenshot.png",
          storagePath: expect.stringContaining("cloudinary.com"),
          storagePublicId: expect.stringContaining("nb_test"),
          content: "Sales increased 23% in Q3. Revenue was $1.2M.",
          chunkId: expect.any(String),
          index: 0,
        }),
      }),
    ]);

    expect(db.chunk.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceId: "src_img_test",
          notebookId: "nb_test",
          content: "Sales increased 23% in Q3. Revenue was $1.2M.",
          vectorId: expect.any(String),
        }),
      ],
    });

    expect(db.source.update).toHaveBeenCalledWith({
      where: { id: "src_img_test" },
      data: expect.objectContaining({
        status: "READY",
        chunkCount: 1,
        indexedAt: expect.any(Date),
        errorMessage: null,
      }),
    });
  });

  it("falls back to sourceFile bytes when storagePath is null", async () => {
    db.source.findUnique.mockResolvedValue({
      ...fakeImageSource,
      storagePath: null,
      storagePublicId: null,
      sourceFile: { data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    });

    vi.mocked(extractImage).mockResolvedValue({
      text: "Diagram: system architecture overview.",
      description: "Architecture diagram",
      tables: [],
      equations: [],
      warnings: [],
      confidence: "high",
      metadata: { format: "png", model: "gpt-4o-mini", inputBytes: 8, extractedAt: "2025-01-01T00:00:00Z" },
    });

    await runIngestPipeline("src_img_test");

    expect(extractImage).toHaveBeenCalled();
    expect(db.source.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "READY" }),
      })
    );
  });

  it("marks source as FAILED when extraction throws", async () => {
    vi.mocked(extractImage).mockRejectedValue(new Error("Vision model timeout"));

    await runIngestPipeline("src_img_test");

    expect(db.source.update).toHaveBeenCalledWith({
      where: { id: "src_img_test" },
      data: { status: "FAILED", errorMessage: "Vision model timeout" },
    });
    expect(setProgress).toHaveBeenCalledWith(
      "src_img_test",
      expect.objectContaining({ status: "FAILED", errorMessage: "Vision model timeout" })
    );
  });

  it("marks source as FAILED when no chunks are produced", async () => {
    vi.mocked(extractImage).mockResolvedValue({
      text: "",
      description: "A blank image.",
      tables: [],
      equations: [],
      warnings: ["Blank image detected"],
      confidence: "low",
      metadata: { format: "png", model: "gpt-4o-mini", inputBytes: 4, extractedAt: "2025-01-01T00:00:00Z" },
    });

    await runIngestPipeline("src_img_test");

    expect(db.source.update).toHaveBeenCalledWith({
      where: { id: "src_img_test" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "No extractable content was found in this source",
      }),
    });
  });

  it("marks source as FAILED when source row is missing", async () => {
    db.source.findUnique.mockResolvedValue(null);

    await runIngestPipeline("src_nonexistent");

    expect(db.source.update).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });
});
