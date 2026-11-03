import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server routes read prompts, the kit and the example games from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**", "./examples/**", "./public/siwi-kit.js", "./public/siwi-harness.js"],
  },
};

export default nextConfig;
