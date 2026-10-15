import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exifr lazily requires fs/zlib; load it from node_modules instead of bundling.
  serverExternalPackages: ["exifr"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
