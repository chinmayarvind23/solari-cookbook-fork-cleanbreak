// Check remote Browser connectivity with a public fixture page.
import { runLiveSolariSmoke } from "../lib/solari/runtime"

const run = await runLiveSolariSmoke()

console.log(
  JSON.stringify(
    {
      id: run.id,
      status: run.status,
      sessionId: run.sessionId,
      profileId: run.profileId,
      profileCreated: run.profileCreated,
      targetUrl: run.targetUrl,
      pageTitle: run.pageTitle,
      screenshotUrl: run.screenshotUrl,
      recordingStatus: run.recordingStatus,
      replayUrlAvailable: Boolean(run.replayUrl),
      browserReleased: run.browserReleased,
      clientClosed: run.clientClosed,
      profileStateSaved: run.profileStateSaved,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    },
    null,
    2,
  ),
)

if (run.status !== "SUCCEEDED") process.exitCode = 1
