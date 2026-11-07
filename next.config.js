/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Expose the PUBLIC endpoint values to the browser bundle. These are public
  // identifiers (Supabase project URL, publishable anon key, LiveKit wss URL)
  // that the client needs to connect. Server secrets (LIVEKIT_API_KEY and
  // LIVEKIT_API_SECRET) must NEVER be listed here — they stay server-only.
  env: {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    LIVEKIT_URL: process.env.LIVEKIT_URL,
  },
};

export default nextConfig;
