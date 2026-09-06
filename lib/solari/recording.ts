// Track Browser replay availability and safe recording metadata.
import type { RecordingStatus } from "@/lib/solari/types"

export type ReplayResult = {
  status: RecordingStatus
  url: string | null
}

export async function pollForReplay(
  fetchReplay: () => Promise<{ url: string }>,
  options: {
    attempts?: number
    delayMs?: number
    sleep?: (milliseconds: number) => Promise<void>
  } = {},
): Promise<ReplayResult> {
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 3_000
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const replay = await fetchReplay()
      return { status: "AVAILABLE", url: replay.url }
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : undefined
      if (status !== 404) return { status: "FAILED", url: null }
      if (attempt < attempts) await sleep(delayMs)
    }
  }

  return { status: "UNAVAILABLE", url: null }
}
