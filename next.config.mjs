/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output: produces a self-contained .next/standalone with only
  // the runtime files needed to serve the app — used by the Dockerfile.
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "pg"],
  },
  async redirects() {
    return [
      // The Work surface at /work is the only task list UI; /tasks predates it
      // and would otherwise 404. Keep the natural URL working for users and
      // old bookmarks. /tasks/:id keeps its real page (app/tasks/[id]).
      { source: "/tasks", destination: "/work", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
