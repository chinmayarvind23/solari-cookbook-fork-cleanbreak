// Attach Browser profiles and enforce separate persistence eligibility.
import "server-only"

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { Solari } from "@solarisdk/browser"

import { getSolariReadiness, readSolariConfig } from "@/lib/solari/config"
import { createSolariRunRepository } from "@/lib/solari/repository"
import { runSolariSmoke, type SolariClientLike } from "@/lib/solari/runner"
import { toPublicSolariRun, type PublicSolariRun } from "@/lib/solari/types"

const artifactDirectory = resolve(process.cwd(), "artifacts", "solari")

export function solariReadiness() {
  return getSolariReadiness(process.env)
}

export function latestSolariRun(): PublicSolariRun | null {
  const run = createSolariRunRepository().getLatest()
  return run ? toPublicSolariRun(run) : null
}

export async function runLiveSolariSmoke(): Promise<PublicSolariRun> {
  const config = readSolariConfig(process.env)
  return runSolariSmoke(config, {
    repository: createSolariRunRepository(),
    createClient(apiKey) {
      const solari = new Solari({ apiKey })
      return {
        profiles: {
          list: () => solari.profiles.list(),
          create: (options) => solari.profiles.create(options),
          save: (profileId, storageState) =>
            solari.profiles.save(
              profileId,
              storageState as Parameters<typeof solari.profiles.save>[1],
            ),
        },
        sessions: {
          getReplayUrl: (sessionId) => solari.sessions.getReplayUrl(sessionId),
        },
        launch: async (options) =>
          (await solari.launch(options)) as unknown as Awaited<
            ReturnType<SolariClientLike["launch"]>
          >,
        close: () => solari.close(),
      }
    },
    prepareScreenshot(runId) {
      mkdirSync(artifactDirectory, { recursive: true })
      return {
        absolutePath: resolve(artifactDirectory, `${runId}.png`),
        relativePath: `artifacts/solari/${runId}.png`,
      }
    },
  })
}
