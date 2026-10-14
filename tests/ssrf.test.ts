import { describe, it, expect } from "vitest";
import { isPrivateIp, isPrivateIpv6, validateAndResolveUrl } from "../src/lib/ssrf";

describe("isPrivateIp", () => {
  it("rejects loopback 127.x.x.x", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("rejects 10.x private range", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("rejects 172.16.x.x private range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("allows 172.15.x.x (outside private range)", () => {
    expect(isPrivateIp("172.15.255.255")).toBe(false);
  });

  it("allows 172.32.x.x (outside private range)", () => {
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("rejects 192.168.x.x private range", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("rejects 127.0.0.0/8 entirely", () => {
    expect(isPrivateIp("127.1.2.3")).toBe(true);
    expect(isPrivateIp("127.0.0.0")).toBe(true);
  });

  it("rejects 0.x.x.x", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("0.1.2.3")).toBe(true);
  });

  it("rejects 169.254.x.x (link-local)", () => {
    expect(isPrivateIp("169.254.0.1")).toBe(true);
    expect(isPrivateIp("169.254.255.255")).toBe(true);
  });

  it("rejects 100.64.x.x (carrier-grade NAT)", () => {
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
  });

  it("rejects metadata IPs (169.254.169.254)", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("172.217.16.142")).toBe(false);
  });

  it("handles invalid IP", () => {
    expect(isPrivateIp("not-an-ip")).toBe(false);
    expect(isPrivateIp("256.1.1.1")).toBe(false);
  });

  it("does not treat raw IPv6 as private IPv4", () => {
    expect(isPrivateIp("::1")).toBe(false);
    expect(isPrivateIp("0:0:0:0:0:0:0:1")).toBe(false);
  });

  it("does not detect IPv4-mapped IPv6 in isPrivateIp (IPv4-only check)", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(false);
  });
});

describe("isPrivateIpv6", () => {
  it("rejects ::1 loopback", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
  });

  it("rejects :: (unspecified)", () => {
    expect(isPrivateIpv6("::")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 loopback", () => {
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:7f00:1")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 metadata endpoint", () => {
    expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true);
  });

  it("rejects ULA (unique local address)", () => {
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    expect(isPrivateIpv6("fd12:3456:789a::1")).toBe(true);
  });

  it("rejects link-local", () => {
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("fe80::1%eth0")).toBe(true);
  });

  it("rejects multicast", () => {
    expect(isPrivateIpv6("ff02::1")).toBe(true);
  });

  it("rejects NAT64-mapped loopback", () => {
    expect(isPrivateIpv6("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateIpv6("64:ff9b::169.254.169.254")).toBe(true);
  });

  it("rejects 6to4-mapped loopback", () => {
    expect(isPrivateIpv6("2002:7f00:1::")).toBe(true);
  });

  it("rejects documentation prefix", () => {
    expect(isPrivateIpv6("2001:db8::1")).toBe(true);
  });

  it("rejects malformed addresses (fail closed)", () => {
    expect(isPrivateIpv6("not-an-ip")).toBe(true);
    expect(isPrivateIpv6("::ffff:999.999.999.999")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false);
  });
});

describe("validateAndResolveUrl", () => {
  it("rejects non-http protocols", async () => {
    const result = await validateAndResolveUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Protocol/);
  });

  it("rejects invalid URLs", async () => {
    const result = await validateAndResolveUrl("not-a-url");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid URL");
  });

  it("rejects metadata.google.internal", async () => {
    const result = await validateAndResolveUrl("http://metadata.google.internal/computeMetadata/v1/");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/metadata/);
  });

  it("rejects .internal hostnames", async () => {
    const result = await validateAndResolveUrl("http://foo.internal/bar");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/metadata/);
  });

  it("allows http:// and https:// schemes at the protocol stage", async () => {
    const result = await validateAndResolveUrl("https://example.com/page");
    if (!result.ok) {
      expect(result.error).not.toMatch(/Protocol/);
    }
  });

  it("rejects localhost", async () => {
    const result = await validateAndResolveUrl("http://localhost/admin");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Blocked (private IP|loopback IPv6)/);
  });

  it("rejects IPv6 loopback ::1", async () => {
    const result = await validateAndResolveUrl("http://[::1]:8080/test");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Blocked loopback IPv6/);
  });

  it("rejects gopher:// protocol", async () => {
    const result = await validateAndResolveUrl("gopher://127.0.0.1:6379/_INFO");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Protocol/);
  });

  it("rejects ftp:// protocol", async () => {
    const result = await validateAndResolveUrl("ftp://example.com/file");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Protocol/);
  });

  it("rejects metadata endpoint by IP", async () => {
    const result = await validateAndResolveUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Blocked private IP|Blocked private\/metadata hostname/);
  });

  it("allows URLs with credentials at the protocol stage", async () => {
    const result = await validateAndResolveUrl("https://user:pass@example.com/page");
    expect(result.ok).toBe(true);
  });

  it("preserves the original URL on success", async () => {
    const result = await validateAndResolveUrl("https://example.com/page#section");
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://example.com/page#section");
  });

  it("allows URLs with explicit public port", async () => {
    const result = await validateAndResolveUrl("https://example.com:443/path?query=1");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["http://[::1]/", "IPv6 loopback ::1"],
    ["http://[::]/", "IPv6 unspecified ::"],
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped IPv6 loopback (dotted)"],
    ["http://[::ffff:7f00:1]/", "IPv4-mapped IPv6 loopback (hex)"],
    ["http://[::ffff:169.254.169.254]/", "IPv4-mapped IPv6 metadata"],
    ["http://[fd00::1]/", "ULA"],
    ["http://[fe80::1]/", "link-local"],
    ["http://[64:ff9b::7f00:1]/", "NAT64 loopback"],
    ["http://[64:ff9b::169.254.169.254]/", "NAT64 metadata"],
    ["http://[2002:7f00:1::]/", "6to4 loopback"],
    ["http://[2001:db8::1]/", "documentation prefix"],
    ["http://[::1]:8080/test", "IPv6 loopback with port"],
  ])("rejects %s (%s)", async (url) => {
    const result = await validateAndResolveUrl(url);
    expect(result.ok).toBe(false);
  });

  it("allows public IPv6 URLs", async () => {
    const result = await validateAndResolveUrl("http://[2606:4700:4700::1111]/");
    expect(result.ok).toBe(true);
  });
});
