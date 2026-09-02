import type { DatabaseSync, SQLInputValue } from "node:sqlite"

import { getDatabase } from "@/lib/db"
import type {
  RecordingStatus,
  SolariRun,
  SolariRunPatch,
  SolariRunRepository,
  SolariRunStatus,
} from "@/lib/solari/types"

type SolariRunRow = {
  id: string
  created_at: string
  completed_at: string | null
  status: SolariRunStatus
  session_id: string | null
  profile_id: string | null
  profile_created: number
  target_url: string
  page_title: string | null
  observed_text: string | null
  screenshot_path: string | null
  recording_status: RecordingStatus
  replay_url: string | null
  duration_ms: number | null
  browser_released: number
  client_closed: number
  profile_state_saved: number
  error_code: string | null
  error_message: string | null
}

const columns: Record<keyof SolariRunPatch, string> = {
  completedAt: "completed_at",
  status: "status",
  sessionId: "session_id",
  profileId: "profile_id",
  profileCreated: "profile_created",
  targetUrl: "target_url",
  pageTitle: "page_title",
  observedText: "observed_text",
  screenshotPath: "screenshot_path",
  recordingStatus: "recording_status",
  replayUrl: "replay_url",
  durationMs: "duration_ms",
  browserReleased: "browser_released",
  clientClosed: "client_closed",
  profileStateSaved: "profile_state_saved",
  errorCode: "error_code",
  errorMessage: "error_message",
}

function fromRow(row: SolariRunRow): SolariRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    status: row.status,
    sessionId: row.session_id,
    profileId: row.profile_id,
    profileCreated: Boolean(row.profile_created),
    targetUrl: row.target_url,
    pageTitle: row.page_title,
    observedText: row.observed_text,
    screenshotPath: row.screenshot_path,
    recordingStatus: row.recording_status,
    replayUrl: row.replay_url,
    durationMs: row.duration_ms,
    browserReleased: Boolean(row.browser_released),
    clientClosed: Boolean(row.client_closed),
    profileStateSaved: Boolean(row.profile_state_saved),
    errorCode: row.error_code,
    errorMessage: row.error_message,
  }
}

function databaseValue(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return Number(value)
  if (value === undefined) return null
  return value as SQLInputValue
}

export function createSolariRunRepository(
  database: DatabaseSync = getDatabase(),
): SolariRunRepository {
  return {
    create(run) {
      database
        .prepare(
          `INSERT INTO solari_runs (
            id, created_at, completed_at, status, session_id, profile_id,
            profile_created, target_url, page_title, observed_text,
            screenshot_path, recording_status, replay_url, duration_ms,
            browser_released, client_closed, profile_state_saved,
            error_code, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.createdAt,
          run.completedAt,
          run.status,
          run.sessionId,
          run.profileId,
          Number(run.profileCreated),
          run.targetUrl,
          run.pageTitle,
          run.observedText,
          run.screenshotPath,
          run.recordingStatus,
          run.replayUrl,
          run.durationMs,
          Number(run.browserReleased),
          Number(run.clientClosed),
          Number(run.profileStateSaved),
          run.errorCode,
          run.errorMessage,
        )
    },

    update(id, patch) {
      const entries = Object.entries(patch) as [keyof SolariRunPatch, unknown][]
      if (entries.length === 0) return
      const assignments = entries.map(([key]) => `${columns[key]} = ?`)
      database
        .prepare(
          `UPDATE solari_runs SET ${assignments.join(", ")} WHERE id = ?`,
        )
        .run(...entries.map(([, value]) => databaseValue(value)), id)
    },

    getById(id) {
      const row = database
        .prepare("SELECT * FROM solari_runs WHERE id = ?")
        .get(id) as SolariRunRow | undefined
      return row ? fromRow(row) : null
    },

    getLatest() {
      const row = database
        .prepare("SELECT * FROM solari_runs ORDER BY created_at DESC LIMIT 1")
        .get() as SolariRunRow | undefined
      return row ? fromRow(row) : null
    },
  }
}
