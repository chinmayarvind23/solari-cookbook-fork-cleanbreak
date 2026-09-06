// Run visual Desktop navigation with final cancellation intercepted.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readDesktopConfig } from "@/lib/desktop/config"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { successfulDesktopValidation } from "@/lib/desktop/evidence"
import { confirmTerminal, terminalSignals } from "./desktop-terminal"

export async function desktopDryRunCommand(
  args = process.argv.slice(2),
  environment = process.env,
  dependencies: {
    run?: typeof runDesktopDryRun
    output?: (message: string) => void
    interactive?: boolean
    confirm?: typeof confirmTerminal
  } = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  const confirm = dependencies.confirm ?? confirmTerminal
  if (args.some((arg) => arg !== "--auto") || args.length > 1) {
    output("Usage: npm run real-provider:desktop-dry-run -- [--auto]")
    return 1
  }
  const auto = args.includes("--auto")
  if (!auto && !(dependencies.interactive ?? process.stdin.isTTY)) {
    output(
      "Desktop validation requires an interactive terminal for navigation review.",
    )
    return 1
  }
  // Config errors contain only fixed field names, never env values.
  try {
    readDesktopConfig(environment)
  } catch (error) {
    output(
      error instanceof Error
        ? error.message
        : "Desktop configuration is invalid.",
    )
    return 1
  }
  const signals = terminalSignals()
  try {
    const result = await (dependencies.run ?? runDesktopDryRun)(environment, {
      signal: signals.signal,
      auto,
      progress: output,
      prepare: auto
        ? undefined
        : (url) =>
            confirm(
              `Private local live view: ${url}\nVerify this is your dedicated authenticated provider billing page, with no login form, secrets, or unrelated tabs visible. Type START to begin screenshots/recording and send screenshots to the configured planning model.`,
              "START",
              signals.signal,
            ),
      confirm: auto
        ? undefined
        : (step, decision, hash) => {
            output(JSON.stringify({ step, decision }))
            return confirm(
              `Inspect the live screen and coordinates. Only NON-DESTRUCTIVE navigation may proceed. For cancellation-flow navigation, verify that another review step follows and this click cannot commit cancellation. Never authorize a final cancellation, retention acceptance, purchase, or account/security changes. Type NAVIGATE ${step} ${hash} to approve this one input, otherwise stop.`,
              `NAVIGATE ${step} ${hash}`,
              signals.signal,
            )
          },
      reviewRecording: auto
        ? undefined
        : async (url) => {
            await confirm(
              `VM left running. Optional private recording review: ${url}\nPress Enter to close the local viewer.`,
              "",
              signals.signal,
            )
          },
    })
    output(
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
        automaticDestructiveRetries: result.automaticDestructiveRetries,
        mode: result.mode,
        providerAdapter: result.providerAdapter,
        finalBoundaryEstablished: result.finalBoundaryEstablished,
      }),
    )
    return successfulDesktopValidation(result) ? 0 : 1
  } catch {
    output(
      "Desktop validation failed safely. Inspect private local evidence; if pause was not confirmed, pause the VM in Solari. No raw SDK error is printed.",
    )
    return 1
  } finally {
    signals.dispose()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await desktopDryRunCommand()
