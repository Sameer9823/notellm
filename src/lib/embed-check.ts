/**
 * Checks whether a URL can be embedded in an `<iframe>` by inspecting the
 * X-Frame-Options and CSP `frame-ancestors` headers.
 *
 * A site is considered embeddable only when:
 *  - There is no `X-Frame-Options: DENY` or `SAMEORIGIN` header, AND
 *  - There is no CSP `frame-ancestors` directive, or it allows `*` or
 *    `'self'` (or the requesting origin).
 *
 * `embeddable` defaults to true (fail-open) when headers are missing — the
 * absence of restrictive headers is the normal case for sites that allow
 * embedding.
 */
export function parseEmbedHeaders(headers: Headers): { embeddable: boolean; reason?: string } {
  const xfo = headers.get("x-frame-options");
  if (xfo) {
    const value = xfo.trim().toUpperCase();
    if (value === "DENY") {
      return { embeddable: false, reason: "X-Frame-Options: DENY" };
    }
    if (value === "SAMEORIGIN") {
      return { embeddable: false, reason: "X-Frame-Options: SAMEORIGIN" };
    }
    // "ALLOW-FROM uri" is deprecated and inconsistently supported — treat
    // it as non-embeddable to be safe.
    if (value.startsWith("ALLOW-FROM")) {
      return { embeddable: false, reason: "X-Frame-Options: ALLOW-FROM" };
    }
  }

  const csp = headers.get("content-security-policy");
  if (csp) {
    const frameAncestors = extractFrameAncestors(csp);
    if (frameAncestors !== null) {
      // frame-ancestors with no values means nothing can embed it.
      if (frameAncestors.length === 0) {
        return { embeddable: false, reason: "CSP: frame-ancestors ''none''" };
      }
      // If the directive explicitly lists sources (not just '*'), we can't
      // embed from an arbitrary origin — treat as non-embeddable unless
      // '*' is present.
      const hasWildcard = frameAncestors.some((a) => a === "*");
      if (!hasWildcard) {
        return { embeddable: false, reason: "CSP: frame-ancestors restricts embedding" };
      }
    }
  }

  return { embeddable: true };
}

/**
 * Extracts the list of source lists from a CSP `frame-ancestors` directive.
 * Returns `null` when the directive is absent, or `[]` when it's set to
 * `'none'`.
 */
export function extractFrameAncestors(csp: string): string[] | null {
  const normalized = csp.toLowerCase();
  const match = normalized.match(/frame-ancestors\s+([^;]+)/);
  if (!match) return null;

  const rawSources = match[1].trim().split(/\s+/).filter(Boolean);
  if (rawSources.length === 1 && rawSources[0] === "'none'") {
    return [];
  }

  return rawSources;
}
