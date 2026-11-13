/**
 * The Content-Security-Policy header for every page. Kept free of imports so next.config can use it.
 * Scripts allow 'unsafe-inline' because Next.js writes small inline scripts and no per-request nonce is used.
 * Eval is allowed only while developing, for hot reload.
 */
export function contentSecurityPolicy({ dev, imageBaseUrl }: { dev: boolean; imageBaseUrl: string | null }): string {
  const images = ["'self'", 'data:'];
  if (imageBaseUrl) images.push(new URL(imageBaseUrl).origin);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(' ')}`,
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
