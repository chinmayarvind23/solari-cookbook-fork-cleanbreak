import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readDesktopConfig } from "@/lib/desktop/config"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { successfulDesktopValidation } from "@/lib/desktop/evidence"
import { confirmTerminal, terminalSignals } from "./desktop-terminal"

export async function desktopDryRunCommand() {
  if (!process.stdin.isTTY) {
    console.log(
      "Desktop validation requires an interactive terminal for navigation review.",
    )
    process.exitCode = 1
    return
  }
  // Config errors contain only fixed field names, never env values.
  try {
    readDesktopConfig(process.env)
  } catch (error) {
    console.log(
      error instanceof Error
        ? error.message
        : "Desktop configuration is invalid.",
    )
    process.exitCode = 1
    return
  }
  const signals = terminalSignals()
  try {
    const result = await runDesktopDryRun(process.env, {
      signal: signals.signal,
      prepare: (url) =>
        confirmTerminal(
          `Private local live view: ${url}\nVerify this is your dedicated authenticated provider billing page, with no login form, secrets, or unrelated tabs visible. Type START to begin screenshots/recording and send screenshots to the configured planning model.`,
          "START",
          signals.signal,
        ),
      confirm: (step, decision, hash) => {
        console.log(JSON.stringify({ step, decision }))
        return confirmTerminal(
          `Inspect the live screen and coordinates. Only NON-DESTRUCTIVE navigation may proceed. For cancellation-flow navigation, verify that another review step follows and this click cannot commit cancellation. Never authorize a final cancellation, retention acceptance, purchase, or account/security changes. Type NAVIGATE ${step} ${hash} to approve this one input, otherwise stop.`,
          `NAVIGATE ${step} ${hash}`,
          signals.signal,
        )
      },
      reviewRecording: async (url) => {
        await confirmTerminal(
          `VM paused. Optional private recording review: ${url}\nPress Enter to close the local viewer.`,
          "",
          signals.signal,
        )
      },
    })
    console.log(
      JSON.stringify({
        executor: "desktop",
        state: result.state,
        stopReason: result.stopReason,
        evidence: `artifacts/desktop/${result.id}/job.json`,
        validation: successfulDesktopValidation(result)
          ? `artifacts/desktop/${result.id}/validation.json`
          : null,
        recordingStatus: result.recordingStatus,
        paused: result.paused,
        controlClosed: result.controlClosed,
        destructiveClicksExecuted: result.destructiveClicksExecuted,
        unsafeActionsExecuted: result.unsafeActionsExecuted,
      }),
    )
    if (!successfulDesktopValidation(result)) process.exitCode = 1
  } catch {
    console.log(
      "Desktop validation failed safely. Inspect private local evidence; if pause was not confirmed, pause the VM in Solari. No raw SDK error is printed.",
    )
    process.exitCode = 1
  } finally {
    signals.dispose()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await desktopDryRunCommand()
