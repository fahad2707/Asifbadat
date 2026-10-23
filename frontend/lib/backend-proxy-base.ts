/**
 * fetch() requires a full URL with a scheme. Vercel env is often pasted without https://,
 * which makes fetch throw and the proxy return 502.
 *
 * Paths starting with `/` (e.g. `/express/api`) are same-origin bases for the browser
 * or are resolved on the server using VERCEL_URL when running on Vercel.
 */
export function ensureFetchOriginForBackend(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, '');
  if (t.startsWith('/') && !t.startsWith('//')) {
    return t.replace(/\/+$/, '');
  }
  if (/^(localhost|127\.0\.0\.1)([:/]|$)/i.test(t)) {
    return `http://${t}`.replace(/\/+$/, '');
  }
  return `https://${t}`.replace(/\/+$/, '');
}

/**
 * Origin of the backend (no /api path) for server-side proxies.
 * Prefer BACKEND_URL on Vercel; fall back to NEXT_PUBLIC_API_URL; then local dev.
 */
export function getBackendBaseForProxy(): string {
  const base = process.env.BACKEND_URL?.trim();
  if (base) {
    const stripped = base.replace(/\/+$/, '').replace(/\/api\/?$/i, '');
    return ensureFetchOriginForBackend(stripped);
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    // Relative API base (e.g. /express/api): resolve to absolute URL on Vercel for server-side fetch()
    if (apiUrl.startsWith('/') && !apiUrl.startsWith('//')) {
      const vercelHost = process.env.VERCEL_URL?.trim();
      if (vercelHost) {
        const origin = `https://${vercelHost.replace(/\/+$/, '')}`;
        const noTrail = apiUrl.replace(/\/+$/, '');
        const withoutApi = noTrail.replace(/\/api\/?$/i, '');
        return `${origin}${withoutApi}`.replace(/\/+$/, '');
      }
      // Local `next dev`: Express has no /express prefix — proxy to default backend origin.
      return 'http://localhost:5001';
    }
    const stripped = apiUrl.replace(/\/+$/, '').replace(/\/api\/?$/i, '');
    return ensureFetchOriginForBackend(stripped);
  }
  return 'http://localhost:5001';
}
