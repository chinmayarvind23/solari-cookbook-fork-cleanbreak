import { beforeAll, describe, expect, it } from "vitest"

import {
  aggregateBenchmark,
  criticalInvariantFailures,
  median,
  p95,
  serializeBenchmarkResults,
} from "@/lib/benchmark/aggregate"
import { BENCHMARK_SCENARIOS, runBenchmarkSuite } from "@/lib/benchmark/runner"
import type { BenchmarkResults, LiveValidation } from "@/lib/benchmark/types"

const noLiveRun: LiveValidation = {
  performed: false,
  scenario: null,
  model: null,
  agentSteps: null,
  retentionOffersRejected: null,
  destructiveClicks: null,
  automaticDestructiveRetries: null,
  executionAndVerificationSessionsDiffered: null,
  verificationResult: null,
  falseVerified: null,
  receiptGenerated: null,
}

describe("Milestone 7 benchmark statistics", () => {
  it("calculates median and nearest-rank p95", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(p95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95)
  })
})

describe("Milestone 7 deterministic benchmark suite", () => {
  let results: BenchmarkResults
  let repeatResults: BenchmarkResults

  beforeAll(async () => {
    results = await runBenchmarkSuite({
      seed: 424242,
      repetitions: 1,
      liveValidation: noLiveRun,
    })
    repeatResults = await runBenchmarkSuite({
      seed: 424242,
      repetitions: 1,
      liveValidation: noLiveRun,
    })
  })

  it("executes every required scenario with a deterministic seed", () => {
    expect(results.seed).toBe(424242)
    expect(results.totalRuns).toBe(BENCHMARK_SCENARIOS.length)
    expect(Object.keys(results.scenarioResults)).toEqual(
      [...BENCHMARK_SCENARIOS].sort(),
    )
    expect(
      results.runs.map(({ runId, scenario }) => ({ runId, scenario })),
    ).toEqual(
      repeatResults.runs.map(({ runId, scenario }) => ({ runId, scenario })),
    )
  })

  it("aggregates per-scenario pass rate and overall pass rate", () => {
    expect(results.passRate).toBe(1)
    expect(results.failedRuns).toBe(0)
    expect(
      Object.values(results.scenarioResults).every(
        (scenario) => scenario.runs === 1 && scenario.passRate === 1,
      ),
    ).toBe(true)
  })

  it("enforces all destructive-action safety invariants", () => {
    expect(criticalInvariantFailures(results)).toEqual([])
    expect(results.falseVerified).toBe(0)
    expect(results.unsafeActionsExecuted).toBe(0)
    expect(results.automaticDestructiveRetries).toBe(0)
    expect(Object.values(results.safety).every((value) => value === 0)).toBe(
      true,
    )
    expect(
      criticalInvariantFailures({ ...results, falseVerified: 1 }),
    ).toContain("falseVerified must be zero.")
    const falsified = aggregateBenchmark(
      [{ ...results.runs[0], falseVerified: true }, ...results.runs.slice(1)],
      {
        seed: results.seed,
        generatedAt: results.generatedAt,
        liveValidation: noLiveRun,
      },
    )
    expect(falsified.falseVerified).toBe(1)
    expect(criticalInvariantFailures(falsified)).toContain(
      "falseVerified must be zero.",
    )
  })

  it("covers negative, inconclusive, crash, and loop outcomes", () => {
    expect(results.notVerifiedRuns).toBeGreaterThan(0)
    expect(results.inconclusiveRuns).toBeGreaterThan(0)
    expect(results.agent.loopsDetected).toBe(1)
    expect(results.agent.lowConfidenceStops).toBe(1)
    expect(results.scenarioResults["crash-after-dispatch"].verified).toBe(1)
  })

  it("creates receipts for every and only VERIFIED job", () => {
    expect(results.receipts.receiptGenerationFailures).toBe(0)
    expect(results.receipts.receiptIntegrityFailures).toBe(0)
    expect(results.receipts.receiptsCreated).toBe(results.receipts.verifiedJobs)
    expect(
      results.runs.every(
        (run) => run.receiptCreated === (run.verificationResult === "VERIFIED"),
      ),
    ).toBe(true)
    expect(results.challengeMetrics.receiptCoverage).toBe(1)
    expect(results.challengeMetrics.verificationCoverage).toBe(1)
  })

  it("emits valid machine-readable JSON with run and timing data", () => {
    const parsed = JSON.parse(
      serializeBenchmarkResults(results),
    ) as BenchmarkResults
    expect(parsed.totalRuns).toBe(results.totalRuns)
    expect(parsed.runs).toHaveLength(results.totalRuns)
    expect(parsed.runs.every((run) => run.startedAt && run.completedAt)).toBe(
      true,
    )
    expect(parsed.timing.totalJobDurationMs.p95).toBeGreaterThanOrEqual(
      parsed.timing.totalJobDurationMs.median,
    )
  })
})
