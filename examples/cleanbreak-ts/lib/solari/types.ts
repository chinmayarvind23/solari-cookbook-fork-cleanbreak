export type SolariRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED"
export type RecordingStatus = "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "FAILED"

export type SolariRun = {
  id: string
  createdAt: string
  completedAt: string | null
  status: SolariRunStatus
  sessionId: string | null
  profileId: string | null
  profileCreated: boolean
  targetUrl: string
  pageTitle: string | null
  observedText: string | null
  screenshotPath: string | null
  recordingStatus: RecordingStatus
  replayUrl: string | null
  durationMs: number | null
  browserReleased: boolean
  clientClosed: boolean
  profileStateSaved: boolean
  errorCode: string | null
  errorMessage: string | null
}

export type SolariRunPatch = Partial<Omit<SolariRun, "id" | "createdAt">>

export type PublicSolariRun = Omit<SolariRun, "screenshotPath"> & {
  screenshotUrl: string | null
}

export interface SolariRunRepository {
  create(run: SolariRun): void
  update(id: string, patch: SolariRunPatch): void
  getById(id: string): SolariRun | null
  getLatest(): SolariRun | null
}

export function toPublicSolariRun(run: SolariRun): PublicSolariRun {
  const { screenshotPath, ...safe } = run
  return {
    ...safe,
    screenshotUrl: screenshotPath
      ? `/api/solari/runs/${encodeURIComponent(run.id)}/screenshot`
      : null,
  }
}
