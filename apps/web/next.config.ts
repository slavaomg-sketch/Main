import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@techmatch/ui', '@techmatch/domain', '@techmatch/database', '@techmatch/integrations', '@techmatch/config', '@techmatch/validation'],
  serverExternalPackages: ['@prisma/client', 'prisma', 'sharp', 'xlsx'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    localPatterns: [{ pathname: '/media/**' }, { pathname: '/**' }],
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [64, 96, 128, 160, 240, 320],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      { source: '/media/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/fonts/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
