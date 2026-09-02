import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadEnvFile } from "node:process"

import type { NextConfig } from "next"

const rootEnvironment = resolve(process.cwd(), ".env")
if (existsSync(rootEnvironment)) loadEnvFile(rootEnvironment)

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: [
    "node:sqlite",
    "@solarisdk/browser",
    "patchright-core",
    "chromium-bidi",
  ],
}

export default nextConfig
