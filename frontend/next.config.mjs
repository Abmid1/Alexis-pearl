/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output folder. Set NEXT_DIST_DIR to build without disturbing a running
  // `npm run dev` (both would otherwise write to .next and corrupt each other):
  //   NEXT_DIST_DIR=.next-build npx next build
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
export default nextConfig;
