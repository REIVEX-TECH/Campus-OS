/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages ship TypeScript source; Next transpiles them.
  transpilePackages: [
    '@campusos/ui',
    '@campusos/core',
    '@campusos/tenants',
    '@campusos/db',
    '@campusos/media',
    '@campusos/module-timetable',
  ],
  // sharp is a native module: keep it external so Next requires the prebuilt
  // binary from node_modules at runtime instead of bundling it (bundling breaks
  // the platform-binary resolution and fails `next build`). serverExternalPackages
  // is not enough here because sharp is reached through a transpiled workspace
  // package (@campusos/media), so also mark it external in the server webpack
  // build.
  serverExternalPackages: ['sharp'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, 'sharp']
        : [config.externals, 'sharp'].filter(Boolean);
    }
    return config;
  },
  // Linting runs as its own workspace task (pnpm lint), not during build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
