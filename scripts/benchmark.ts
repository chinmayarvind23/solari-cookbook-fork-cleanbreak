// Run deterministic scenarios and refresh the published benchmark table.
import "server-only"

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { format } from "prettier"

import {
  criticalInvariantFailures,
  serializeBenchmarkResults,
} from "@/lib/benchmark/aggregate"
import { runBenchmarkSuite } from "@/lib/benchmark/runner"

const artifactPath = resolve(
  process.cwd(),
  "artifacts",
  "benchmark-results.json",
)
const readmePath = resolve(process.cwd(), "README.md")
const startMarker = "<!-- BENCHMARK_RESULTS_START -->"
const endMarker = "<!-- BENCHMARK_RESULTS_END -->"

const results = await runBenchmarkSuite()
const failures = criticalInvariantFailures(results)

mkdirSync(dirname(artifactPath), { recursive: true })
writeFileSync(artifactPath, serializeBenchmarkResults(results), "utf8")

const measuredSection = `${startMarker}
## Measured results

Deterministic offline results from \`artifacts/benchmark-results.json\`.

| Measure | Result |
| --- | ---: |
| Runs | ${results.passedRuns}/${results.totalRuns} passed (${(results.passRate * 100).toFixed(1)}%) |
| False verified | ${results.falseVerified} |
| Unsafe actions executed | ${results.unsafeActionsExecuted} |
| Automatic destructive retries | ${results.automaticDestructiveRetries} |
| Retention resistance | ${(results.challengeMetrics.retentionResistance * 100).toFixed(1)}% |
| Verification / VERIFIED receipt coverage | ${(results.challengeMetrics.verificationCoverage * 100).toFixed(1)}% / ${(results.challengeMetrics.receiptCoverage * 100).toFixed(1)}% |

${endMarker}`

const readme = readFileSync(readmePath, "utf8")
const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "m")
if (!markerPattern.test(readme)) {
  throw new Error("README benchmark result markers are missing.")
}
writeFileSync(
  readmePath,
  await format(readme.replace(markerPattern, measuredSection), {
    parser: "markdown",
  }),
  "utf8",
)

console.log(
  `CleanBreak benchmark complete\n\nRuns: ${results.totalRuns}\nPassed: ${results.passedRuns}\nPass rate: ${(results.passRate * 100).toFixed(1)}%\n\nFalse VERIFIED: ${results.falseVerified}\nUnsafe actions executed: ${results.unsafeActionsExecuted}\nAutomatic destructive retries: ${results.automaticDestructiveRetries}\n\nRetention offers: ${results.retentionOffersRejected}/${results.retentionScreensEncountered} rejected\nVERIFIED jobs: ${results.verifiedRuns}\nReceipt coverage: ${(results.challengeMetrics.receiptCoverage * 100).toFixed(1)}%`,
)
console.log(`\nResults:\n${artifactPath}`)
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
