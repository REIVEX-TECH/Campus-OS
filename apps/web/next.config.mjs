/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages ship TypeScript source; Next transpiles them.
  transpilePackages: ['@campusos/ui', '@campusos/core'],
  // Linting runs as its own workspace task (pnpm lint), not during build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
