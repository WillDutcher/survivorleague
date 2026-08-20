/**
 * ESPN fetch proxy — Cloudflare Worker.
 *
 * WHY THIS EXISTS
 * ESPN returns 403 to requests from Vercel (D34). The endpoints are public and
 * unauthenticated, but ESPN filters callers and a datacentre IP does not pass.
 * Cloudflare Workers egress from Cloudflare's edge instead, which may. This is
 * the cheapest way to find out, and if it works the scheduled jobs can fetch
 * normally.
 *
 * SECURITY — read before changing anything
 * A proxy that will fetch any URL for anyone is an open relay. It would let
 * strangers launder traffic through your Cloudflare account, and it is the sort
 * of thing that gets an account suspended. Two guards, both mandatory:
 *
 *   1. A shared secret. No secret, no response. Set PROXY_SECRET as a Worker
 *      secret (encrypted), never as a plain variable.
 *   2. A host allowlist. Only ESPN's public API host is reachable, and only
 *      GET. Any other host is refused even with a valid secret.
 *
 * Neither guard is optional. Removing either turns this into an open proxy.
 */

const ALLOWED_HOSTS = new Set(["site.api.espn.com", "site.web.api.espn.com"]);

/** ESPN rejects callers that do not look like a browser. */
const UPSTREAM_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/",
};

function deny(reason, status) {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return deny("Only GET is proxied.", 405);

    // Guard 1: shared secret. Compared in constant time so the endpoint cannot
    // be probed a character at a time.
    const provided = request.headers.get("x-proxy-secret") ?? "";
    const expected = env.PROXY_SECRET ?? "";
    if (!expected) return deny("Proxy is not configured.", 500);
    if (!constantTimeEqual(provided, expected)) {
      // Diagnostic only: reports LENGTHS and nothing else, so a mismatch can be
      // told apart from a stray space or a truncated paste without ever
      // revealing either secret. Remove once the proxy is confirmed working.
      return new Response(
        JSON.stringify({
          error: "Forbidden.",
          expectedLength: expected.length,
          providedLength: provided.length,
          expectedStartsWith: expected.slice(0, 3),
          providedStartsWith: provided.slice(0, 3),
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return deny("Missing url parameter.", 400);

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return deny("Malformed url parameter.", 400);
    }

    // Guard 2: host allowlist. This is what stops it being an open proxy.
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
      return deny(`Host not allowed: ${parsed.hostname}`, 403);
    }

    const upstream = await fetch(parsed.toString(), {
      headers: UPSTREAM_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    // Pass the status through untouched. A 403 from ESPN must surface as a 403,
    // not be dressed up as success — otherwise the app would parse an error page
    // as if it were a scoreboard.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-proxied-by": "survivor-league-espn-proxy",
      },
    });
  },
};

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
