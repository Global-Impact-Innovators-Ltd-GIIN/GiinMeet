/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Expose the PUBLIC endpoint values to the browser bundle. These are public
  // identifiers (Supabase project URL, publishable anon key, LiveKit wss URL)
  // that the client needs to connect. Server secrets (LIVEKIT_API_KEY and
  // LIVEKIT_API_SECRET) must NEVER be listed here, they stay server-only.
  env: {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    LIVEKIT_URL: process.env.LIVEKIT_URL,
  },
  // Phase C1, security headers on every response (layered defence; the
  // API routes also set them per-answer via app/api/_lib/security.ts).
  // SAMEORIGIN framing: GiinMeet is never embedded in another site.
  // Permissions-Policy keeps camera/mic to this origin only.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
