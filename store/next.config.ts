import { join } from 'node:path';
import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './src/server/csp';

// The repository root is the build root, because prices and VAT come from the POS's own src/core files, not a copy.
const repoRoot = join(__dirname, '..');

const config: NextConfig = {
  poweredByHeader: false,
  // The build checks the website code only. Tests also load the real POS, whose packages are not installed on the host.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  reactStrictMode: true,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy({ dev: process.env.NODE_ENV !== 'production', imageBaseUrl: process.env.STORE_IMAGE_BASE_URL?.trim() || null }) },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
