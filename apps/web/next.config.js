/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API runs on :4000; proxy avoids CORS in dev and keeps cookies simple.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

module.exports = nextConfig;
