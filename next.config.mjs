/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/pandoc chạy Pandoc binary ngay trong function — cần bundle bin/pandoc.gz.
  outputFileTracingIncludes: {
    '/api/pandoc': ['./bin/**'],
  },
};
export default nextConfig;
