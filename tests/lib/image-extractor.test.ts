import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractImage } from "@/lib/extractors/image";

vi.mock("@/lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  VISION_MODEL: "gpt-4o-mini",
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

import { openai, VISION_MODEL } from "@/lib/openai";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("extractImage", () => {
  const mockCreate = vi.mocked(openai.chat.completions.create);
  const buffer = Buffer.concat([JPEG_MAGIC, Buffer.from("fake-image-data")]);

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("auto-detects format from buffer and calls vision model", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ text: "Hello world" }) } }],
    } as any);

    const result = await extractImage(buffer);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: VISION_MODEL,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "image_url" }),
            ]),
          }),
        ]),
      })
    );
    expect(result.text).toBe("Hello world");
    expect(result.metadata.model).toBe(VISION_MODEL);
    expect(result.metadata.format).toBe("jpg");
    expect(result.metadata.inputBytes).toBe(buffer.length);
  });

  it("passes format explicitly when provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ text: "PNG content" }) } }],
    } as any);

    const result = await extractImage(buffer, "png");
    expect(result.metadata.format).toBe("png");
  });

  it("parses valid JSON response with all fields", async () => {
    const modelResponse = {
      text: "Page 1 content\n\nPage 2 content",
      description: "A chart showing sales data with bars",
      tables: ["| Month | Sales |\n|-------|-------|\n| Jan   | 100   |"],
      equations: ["E = mc^2"],
      warnings: ["Illegible signature in bottom-right"],
      confidence: "high",
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelResponse) } }],
    } as any);

    const result = await extractImage(buffer);

    expect(result.text).toBe("Page 1 content\n\nPage 2 content");
    expect(result.description).toBe("A chart showing sales data with bars");
    expect(result.tables).toHaveLength(1);
    expect(result.equations).toEqual(["E = mc^2"]);
    expect(result.warnings).toEqual(["Illegible signature in bottom-right"]);
    expect(result.confidence).toBe("high");
  });

  it("returns warning when text is empty", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ text: "" }) } }],
    } as any);

    const result = await extractImage(buffer);

    expect(result.text).toBe("");
    expect(result.warnings).toContain("No extractable text was found in this image");
    expect(result.confidence).toBe("low");
  });

  it("returns schema validation failure fallback on invalid JSON schema", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ foo: "bar" }) } }],
    } as any);

    const result = await extractImage(buffer);

    expect(result.text).toBe("");
    expect(result.warnings?.[0]).toContain("did not match expected schema");
    expect(result.confidence).toBe("low");
  });

  it("throws on invalid JSON from the model", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json at all" } }],
    } as any);

    await expect(extractImage(buffer)).rejects.toThrow("Model returned invalid JSON");
  });

  it("throws on empty model response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as any);

    await expect(extractImage(buffer)).rejects.toThrow("Vision model returned an empty response");
  });

  it("re-throws 413/400 errors with a helpful message", async () => {
    const err = new Error("Request too large");
    (err as any).status = 413;
    mockCreate.mockRejectedValue(err);

    await expect(extractImage(buffer)).rejects.toThrow("Image too large or unsupported format");
  });

  it("re-throws 5xx errors unchanged", async () => {
    const err = new Error("Internal server error");
    (err as any).status = 500;
    mockCreate.mockRejectedValue(err);

    await expect(extractImage(buffer)).rejects.toThrow("Internal server error");
  });
});
