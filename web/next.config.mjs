/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Project/agent images are resolved from arbitrary IPFS gateways at
  // runtime, so we render them with plain <img> tags rather than
  // next/image (which would require a fixed remotePatterns allowlist).
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
