import { describe, it, expect } from "vitest";
import { parseEmbedHeaders, extractFrameAncestors } from "../src/lib/embed-check";

describe("parseEmbedHeaders", () => {
  it("defaults to embeddable when no headers are present", () => {
    const headers = new Headers();
    expect(parseEmbedHeaders(headers)).toEqual({ embeddable: true });
  });

  it("blocks X-Frame-Options: DENY", () => {
    const headers = new Headers({ "x-frame-options": "DENY" });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("blocks X-Frame-Options: SAMEORIGIN", () => {
    const headers = new Headers({ "x-frame-options": "SAMEORIGIN" });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("is case-insensitive for X-Frame-Options", () => {
    const headers = new Headers({ "x-frame-options": "deny" });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("allows when X-Frame-Options is empty/garbage", () => {
    const headers = new Headers({ "x-frame-options": "ALLOWALL" });
    expect(parseEmbedHeaders(headers).embeddable).toBe(true);
  });

  it("blocks CSP frame-ancestors set to 'none'", () => {
    const headers = new Headers({
      "content-security-policy": "frame-ancestors 'none';",
    });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("allows CSP frame-ancestors with '*'", () => {
    const headers = new Headers({
      "content-security-policy": "frame-ancestors *;",
    });
    expect(parseEmbedHeaders(headers).embeddable).toBe(true);
  });

  it("blocks CSP frame-ancestors listing specific origins", () => {
    const headers = new Headers({
      "content-security-policy": "frame-ancestors https://example.com;",
    });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("handles multiple CSP headers", () => {
    const headers = new Headers();
    headers.append("content-security-policy", "default-src 'self'");
    headers.append("content-security-policy", "frame-ancestors 'none'");
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("blocks when CSP frame-ancestors is 'self' (no wildcard)", () => {
    const headers = new Headers({
      "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
    });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });

  it("embeds when CSP has no frame-ancestors directive", () => {
    const headers = new Headers({
      "content-security-policy": "default-src 'self'; script-src 'self'",
    });
    expect(parseEmbedHeaders(headers).embeddable).toBe(true);
  });

  it("blocks when X-Frame-Options has leading/trailing whitespace", () => {
    const headers = new Headers({ "x-frame-options": "  DENY  " });
    expect(parseEmbedHeaders(headers).embeddable).toBe(false);
  });
});

describe("extractFrameAncestors", () => {
  it("returns null when directive is absent", () => {
    expect(extractFrameAncestors("default-src 'self'; script-src 'self'")).toBeNull();
  });

  it("returns empty array for 'none'", () => {
    expect(extractFrameAncestors("frame-ancestors 'none'")).toEqual([]);
  });

  it("returns source list", () => {
    expect(extractFrameAncestors("frame-ancestors *")).toEqual(["*"]);
  });

  it("is case-insensitive", () => {
    expect(extractFrameAncestors("FRAME-ANCESTORS 'NONE'")).toEqual([]);
  });

  it("handles multiple sources", () => {
    const result = extractFrameAncestors("frame-ancestors 'self' https://foo.com");
    expect(result).toEqual(["'self'", "https://foo.com"]);
  });
});
