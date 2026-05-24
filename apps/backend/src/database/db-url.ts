/**
 * Defensive URL preprocessor for the Supabase / Postgres DSN.
 *
 * Why this exists: `pg-connection-string` v3 (transitively pulled by
 * `pg@8.21+`) treats `?sslmode=require` as an alias for
 * `verify-full`, which then enforces full chain validation. Supabase's
 * pooler cert is signed by a root that isn't in Node's default trust
 * store → `SELF_SIGNED_CERT_IN_CHAIN` at connect time.
 *
 * Our explicit `ssl: { rejectUnauthorized: false }` option SHOULD
 * override, but the URL-parsed mode wins in practice because pg
 * applies the URL-derived ssl options first.
 *
 * Fix: when SSL is enabled at the application level (DB_SSL=true),
 * strip any `sslmode` query parameter from the URL before handing it
 * to pg. The application then controls TLS via the explicit `ssl`
 * option only, dodging the parser conflict.
 *
 * This is forgiving by design — a misformatted URL is returned
 * unchanged rather than throwing, so a typo in `DATABASE_URL` still
 * lands as the original pg "connection refused" instead of a
 * confusing pre-flight crash.
 */
export function buildPgUrl(rawUrl: string, useSsl: boolean): string {
  if (!useSsl) {
    return rawUrl;
  }
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return rawUrl;
  }
}
