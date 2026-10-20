const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy. Next.js App Router injects inline bootstrap
// scripts/styles, so 'unsafe-inline' is required unless we wire up nonces.
// Dev additionally needs 'unsafe-eval' for react-refresh.
// Third-party allowances are for the Pingie support widget only:
//   script: widget.ping.gtools.in (widget.js)
//   connect: pingbackend-htry.onrender.com (widget API)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://widget.ping.gtools.in`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? ' http://localhost:4000 ws://localhost:3000' : ''} https://pingbackend-htry.onrender.com`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // HSTS only matters over HTTPS; harmless in prod, skipped in dev.
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API runs on :4000; proxy avoids CORS in dev and keeps cookies simple.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
