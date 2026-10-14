import { lookup } from "dns/promises";
import { isIP } from "node:net";

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

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parseIpv6(addr: string): number[] | null {
  let a = addr.toLowerCase().split("%")[0];
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipToNumber(v4[1]);
    if (n < 0) return null;
    a = a.slice(0, -v4[0].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const parts = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...tail];
  if (parts.length !== 8 || parts.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return parts.map((g) => parseInt(g, 16));
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Returns true if an IPv6 address (without brackets) falls within a
 * private/loopback/link-local/multicast/documentation range.
 */
export function isPrivateIpv6(addr: string): boolean {
  const g = parseIpv6(addr);
  if (!g) return true; // malformed -> fail closed
  const zeros5 = g.slice(0, 5).every((x) => x === 0);
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (zeros5 && (g[5] === 0xffff || g[5] === 0)) return isPrivateIp(v4FromGroups(g[6], g[7])); // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIp(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateIp(v4FromGroups(g[1], g[2])); // 6to4
  return false;
}

function blockReason(addr: string, hostname: string): string | null {
  const family = isIP(addr);
  if (family === 4) return isPrivateIp(addr) ? `Blocked private IP address: ${addr} for ${hostname}` : null;
  if (family === 6) {
    if (!isPrivateIpv6(addr)) return null;
    const g = parseIpv6(addr);
    const loopback = !!g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
    return loopback ? `Blocked loopback IPv6 address: ${addr}` : `Blocked private IPv6 address: ${addr} for ${hostname}`;
  }
  return null;
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

  const host = stripBrackets(url.hostname);
  const ipFamily = isIP(host);

  // DNS resolution + private-IP rejection. Even though the snapshot endpoint
  // delegates the actual fetch to Firecrawl (and the web-preview endpoint
  // uses safeFetch), we validate every URL that passes through our API
  // boundary so we're never an SSRF oracle to 169.254.169.254 etc.
  let addresses: string[] = [];
  if (ipFamily) {
    // IP literal — skip DNS, check the literal directly.
    addresses = [host];
  } else {
    try {
      const resolved = await lookup(url.hostname, { all: true });
      addresses = resolved.map((a) => a.address);
    } catch {
      // DNS failure — let the downstream fetch/report the error.
    }
  }

  for (const addr of addresses) {
    const reason = blockReason(addr, url.hostname);
    if (reason) return { ok: false, url: input, error: reason };
  }

  return { ok: true, url: input };
}

/**
 * Fetches a URL with SSRF protection: resolves the hostname, rejects private
 * IPs, follows up to 3 redirects (re-validating DNS on each hop), and times
 * out after 6s. Returns the final Response.
 *
 * NOTE: validate-then-fetch resolves DNS twice, so a DNS-rebinding attacker
 * could theoretically win the race between validation and the actual fetch.
 * A full fix would pin the resolved IP for the connection (custom undici
 * dispatcher/lookup).
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

    const host = stripBrackets(hostname);
    const ipFamily = isIP(host);

    let addresses: string[] = [];
    if (ipFamily) {
      addresses = [host];
    } else {
      try {
        const resolved = await lookup(hostname, { all: true });
        addresses = resolved.map((a) => a.address);
      } catch {
        // DNS failure — fall through and let fetch fail naturally.
      }
    }

    for (const addr of addresses) {
      const reason = blockReason(addr, hostname);
      if (reason) throw new Error(reason);
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
