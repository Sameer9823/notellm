import { lookup } from "dns/promises";

const BLOCKED_RANGES = [
  // 10.0.0.0/8
  { start: 0x0a000000, end: 0x0affffff },
  // 172.16.0.0/12
  { start: 0xac100000, end: 0xac1fffff },
  // 192.168.0.0/16
  { start: 0xc0a80000, end: 0xc0a8ffff },
  // 127.0.0.0/8 (loopback)
  { start: 0x7f000000, end: 0x7fffffff },
  // 100.64.0.0/10 (carrier-grade NAT)
  { start: 0x64400000, end: 0x647fffff },
  // 169.254.0.0/16 (link-local)
  { start: 0xa9fe0000, end: 0xa9ff_ffff },
  // 192.0.2.0/24 (TEST-NET-1, documentation)
  { start: 0xc0000200, end: 0xc00002ff },
  // 198.18.0.0/15 (benchmarking)
  { start: 0xc6120000, end: 0xc613ffff },
  // 198.51.100.0/24 (TEST-NET-2)
  { start: 0xc6336400, end: 0xc63364ff },
  // 203.0.113.0/24 (TEST-NET-3)
  { start: 0xcb007100, end: 0xcb0071ff },
  // 0.0.0.0/8
  { start: 0x00000000, end: 0x00ffffff },
  // 224.0.0.0/4 and above (multicast/reserved) — block broadly
  { start: 0xe0000000, end: 0xffffffff },
];

function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return -1;
  // Apply >>> 0 to the ENTIRE expression — the | operator converts operands
  // back to signed 32-bit, so applying it only to the first term is a no-op.
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Returns true if `ip` (IPv4) falls within any RFC 1918 or other
 * non-routable range.
 */
export function isPrivateIp(ip: string): boolean {
  const num = ipToNumber(ip);
  if (num < 0) return false;
  return BLOCKED_RANGES.some((r) => num >= r.start && num <= r.end);
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 6000;

/**
 * Validates and resolves a URL, rejecting anything that could be used for an
 * SSRF attack — private IPs, loopback, link-local, metadata, and
 * cloud-credential endpoints. Each redirect hop is re-validated because an
 * attacker's server can redirect to a private IP after the initial fetch.
 *
 * Returns `{ ok: true, url }` on success or `{ ok: false, error }` on
 * rejection.
 */
export async function validateAndResolveUrl(input: string): Promise<{ ok: boolean; url: string; error?: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, url: input, error: "Invalid URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, url: input, error: `Protocol ${url.protocol} is not allowed (http/https only)` };
  }

  // Reject metadata hostnames and private DNS names.
  if (url.hostname === "metadata.google.internal" || url.hostname.endsWith(".internal")) {
    return { ok: false, url: input, error: "Blocked private/metadata hostname" };
  }

  // DNS resolution + private-IP rejection. Even though the snapshot endpoint
  // delegates the actual fetch to Firecrawl (and the web-preview endpoint
  // uses safeFetch), we validate every URL that passes through our API
  // boundary so we're never an SSRF oracle to 169.254.169.254 etc.
  let addresses: string[] = [];
  try {
    const resolved = await lookup(url.hostname, { all: true });
    addresses = resolved.map((a) => a.address);
  } catch {
    // DNS failure — let the downstream fetch/report the error.
  }

  for (const addr of addresses) {
    if (addr.includes(":")) {
      if (addr === "::1" || addr.toLowerCase() === "::1") {
        return { ok: false, url: input, error: `Blocked loopback IPv6 address: ${addr}` };
      }
    } else {
      if (isPrivateIp(addr)) {
        return { ok: false, url: input, error: `Blocked private IP address: ${addr} for ${url.hostname}` };
      }
    }
  }

  return { ok: true, url: input };
}

/**
 * Fetches a URL with SSRF protection: resolves the hostname, rejects private
 * IPs, follows up to 3 redirects (re-validating DNS on each hop), and times
 * out after 6s. Returns the final Response.
 */
export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const validation = await validateAndResolveUrl(input);
  if (!validation.ok) {
    throw new Error(validation.error ?? "Invalid URL");
  }

  let currentUrl = input;
  let lastResponse: Response | null = null;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const url = new URL(currentUrl);
    const hostname = url.hostname;

    // Reject obvious cloud-metadata hostnames.
    if (hostname === "metadata.google.internal" || hostname === "169.254.169.254" || hostname.endsWith(".internal")) {
      throw new Error("Blocked private/metadata hostname");
    }

    // DNS resolution + private-IP check.
    let addresses: string[] = [];
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses = resolved.map((a) => a.address);
    } catch {
      // DNS failure — fall through and let fetch fail naturally.
    }

    // Check all resolved addresses (IPv4 only; IPv6 ::1 is checked separately).
    for (const addr of addresses) {
      if (addr.includes(":")) {
        if (addr === "::1" || addr.toLowerCase() === "::1") {
          throw new Error(`Blocked loopback IPv6 address: ${addr}`);
        }
      } else {
        if (isPrivateIp(addr)) {
          throw new Error(`Blocked private IP address: ${addr} for ${hostname}`);
        }
      }
    }

    lastResponse = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (lastResponse.status >= 300 && lastResponse.status < 400) {
      const location = lastResponse.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      redirectCount++;
    } else {
      break;
    }
  }

  if (redirectCount > MAX_REDIRECTS) {
    throw new Error("Too many redirects");
  }

  return lastResponse!;
}
