import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["node:sqlite"],
}

export default nextConfig
