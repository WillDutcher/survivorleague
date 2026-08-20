/**
 * The base URL players should see in links.
 *
 * Deriving this from the incoming request looks right and is wrong for the
 * cases that matter most. Vercel Cron calls the deployment's own
 * `*.vercel.app` hostname, not the custom domain, so every scheduled email —
 * reminders, the Sunday digest, the Monday recap — would link players back to
 * a URL they have never seen. Password reset and verification links have the
 * same problem when triggered from anywhere unusual.
 *
 * So PUBLIC_BASE_URL wins when set, and the request origin is only a fallback
 * for local development where no such variable exists.
 */
export function publicOrigin(requestOrigin: string): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (!configured) return requestOrigin;
  // Tolerate a trailing slash in the environment variable rather than emitting
  // links with a double slash.
  return configured.replace(/\/+$/, "");
}
