import type { DatabaseSync, SQLInputValue } from "node:sqlite"

import { getDatabase } from "@/lib/db"
import type {
  AgentStep,
  CancellationJob,
  ProposedAction,
  PublicAgentJob,
} from "@/lib/agent/types"

type Row = Record<string, unknown>

const jobColumns: Record<keyof CancellationJob, string> = {
  id: "id",
  subscriptionId: "subscription_id",
  state: "state",
  scenario: "scenario",
  model: "model",
  targetUrl: "target_url",
  createdAt: "created_at",
  completedAt: "completed_at",
  sessionId: "session_id",
  profileId: "profile_id",
  recordingStatus: "recording_status",
  replayUrl: "replay_url",
  latestScreenshotPath: "latest_screenshot_path",
  steps: "steps",
  retentionsEncountered: "retentions_encountered",
  retentionsRejected: "retentions_rejected",
  modelCalls: "model_calls",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  policyBlocks: "policy_blocks",
  unsafeActionsExecuted: "unsafe_actions_executed",
  durationMs: "duration_ms",
  browserReleased: "browser_released",
  clientClosed: "client_closed",
  profileStateSaved: "profile_state_saved",
  errorCode: "error_code",
  errorMessage: "error_message",
}

function databaseValue(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return Number(value)
  if (value === undefined) return null
  return value as SQLInputValue
}

function jobFrom(row: Row): CancellationJob {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    state: row.state as CancellationJob["state"],
    scenario: String(row.scenario),
    model: String(row.model),
    targetUrl: String(row.target_url),
    createdAt: String(row.created_at),
    completedAt: (row.completed_at as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    profileId: (row.profile_id as string | null) ?? null,
    recordingStatus: row.recording_status as CancellationJob["recordingStatus"],
    replayUrl: (row.replay_url as string | null) ?? null,
    latestScreenshotPath: (row.latest_screenshot_path as string | null) ?? null,
    steps: Number(row.steps),
    retentionsEncountered: Number(row.retentions_encountered),
    retentionsRejected: Number(row.retentions_rejected),
    modelCalls: Number(row.model_calls),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    policyBlocks: Number(row.policy_blocks),
    unsafeActionsExecuted: 0,
    durationMs: Number(row.duration_ms ?? 0),
    browserReleased: Boolean(row.browser_released),
    clientClosed: Boolean(row.client_closed),
    profileStateSaved: Boolean(row.profile_state_saved),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  }
}

function stepFrom(row: Row): AgentStep {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    stepNumber: Number(row.step_number),
    observationId: String(row.observation_id),
    observedAt: String(row.observed_at),
    url: String(row.url),
    title: String(row.title),
    actionType: (row.action_type as AgentStep["actionType"]) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    targetRole: (row.target_role as string | null) ?? null,
    targetName: (row.target_name as string | null) ?? null,
    reasoning: (row.reasoning as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    risk: (row.risk as AgentStep["risk"]) ?? null,
    policyResult: row.policy_result as AgentStep["policyResult"],
    policyReason: String(row.policy_reason),
    screenshotPath: (row.screenshot_path as string | null) ?? null,
    durationMs: Number(row.duration_ms),
  }
}

export function createAgentRepository(database: DatabaseSync = getDatabase()) {
  return {
    createJob(job: CancellationJob) {
      const keys = Object.keys(jobColumns) as Array<keyof CancellationJob>
      database
        .prepare(
          `INSERT INTO cancellation_jobs (${keys.map((key) => jobColumns[key]).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        )
        .run(...keys.map((key) => databaseValue(job[key])))
    },
    updateJob(id: string, patch: Partial<Omit<CancellationJob, "id">>) {
      const keys = Object.keys(patch) as Array<keyof typeof patch>
      if (!keys.length) return
      database
        .prepare(
          `UPDATE cancellation_jobs SET ${keys.map((key) => `${jobColumns[key as keyof CancellationJob]} = ?`).join(", ")} WHERE id = ?`,
        )
        .run(...keys.map((key) => databaseValue(patch[key])), id)
    },
    getJob(id: string): CancellationJob | null {
      const row = database
        .prepare("SELECT * FROM cancellation_jobs WHERE id = ?")
        .get(id) as Row | undefined
      return row ? jobFrom(row) : null
    },
    getLatestJob(): CancellationJob | null {
      const row = database
        .prepare(
          "SELECT * FROM cancellation_jobs ORDER BY created_at DESC LIMIT 1",
        )
        .get() as Row | undefined
      return row ? jobFrom(row) : null
    },
    addStep(step: AgentStep) {
      database
        .prepare(
          `INSERT INTO agent_steps (
            id, job_id, step_number, observation_id, observed_at, url, title,
            action_type, target_id, target_role, target_name, reasoning,
            confidence, risk, policy_result, policy_reason, screenshot_path, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          step.id,
          step.jobId,
          step.stepNumber,
          step.observationId,
          step.observedAt,
          step.url,
          step.title,
          step.actionType,
          step.targetId,
          step.targetRole,
          step.targetName,
          step.reasoning,
          step.confidence,
          step.risk,
          step.policyResult,
          step.policyReason,
          step.screenshotPath,
          step.durationMs,
        )
    },
    getSteps(jobId: string): AgentStep[] {
      return (
        database
          .prepare(
            "SELECT * FROM agent_steps WHERE job_id = ? ORDER BY step_number",
          )
          .all(jobId) as Row[]
      ).map(stepFrom)
    },
    saveProposedAction(jobId: string, action: ProposedAction) {
      database
        .prepare(
          `INSERT OR REPLACE INTO proposed_actions (
            job_id, detected_at, target_role, target_name, current_url,
            fee_cents, access_until, visible_terms_json, screenshot_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          action.detectedAt,
          action.targetRole,
          action.targetName,
          action.currentUrl,
          action.feeCents,
          action.accessUntil,
          JSON.stringify(action.visibleTerms),
          action.screenshotPath,
        )
    },
    getProposedAction(jobId: string): ProposedAction | null {
      const row = database
        .prepare("SELECT * FROM proposed_actions WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row
        ? {
            detectedAt: String(row.detected_at),
            targetRole: String(row.target_role),
            targetName: String(row.target_name),
            currentUrl: String(row.current_url),
            feeCents: (row.fee_cents as number | null) ?? null,
            accessUntil: (row.access_until as string | null) ?? null,
            visibleTerms: JSON.parse(
              String(row.visible_terms_json),
            ) as string[],
            screenshotPath: (row.screenshot_path as string | null) ?? null,
          }
        : null
    },
  }
}

export type AgentRepository = ReturnType<typeof createAgentRepository>

export function toPublicAgentJob(
  job: CancellationJob,
  repository: AgentRepository,
): PublicAgentJob {
  const { latestScreenshotPath, ...safeJob } = job
  const proposedAction = repository.getProposedAction(job.id)
  return {
    ...safeJob,
    latestScreenshotUrl: latestScreenshotPath
      ? `/api/agent/jobs/${encodeURIComponent(job.id)}/screenshot`
      : null,
    timeline: repository
      .getSteps(job.id)
      .map(({ screenshotPath, ...step }) => ({
        ...step,
        screenshotUrl: screenshotPath
          ? `/api/agent/jobs/${encodeURIComponent(job.id)}/steps/${step.stepNumber}/screenshot`
          : null,
      })),
    proposedAction: proposedAction
      ? {
          detectedAt: proposedAction.detectedAt,
          targetRole: proposedAction.targetRole,
          targetName: proposedAction.targetName,
          currentUrl: proposedAction.currentUrl,
          feeCents: proposedAction.feeCents,
          accessUntil: proposedAction.accessUntil,
          visibleTerms: proposedAction.visibleTerms,
          screenshotUrl: proposedAction.screenshotPath
            ? `/api/agent/jobs/${encodeURIComponent(job.id)}/screenshot`
            : null,
        }
      : null,
  }
}
