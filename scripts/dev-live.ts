// Developer-only web launcher. No provider connection, job creation, or VM input.
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { productConfig } from "../lib/cancellations/config"
import { readHiddenText } from "./desktop-type"
import { terminalSignals } from "./desktop-terminal"

type Dependencies = {
  readPassword(): Promise<string>
  output(message: string): void
  validate(env: NodeJS.ProcessEnv): void
  start(env: NodeJS.ProcessEnv, port: string): Promise<number>
}

export async function runLiveWeb(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies,
): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...environment, NODE_ENV: "development" }
  try {
    const origin = new URL(env.CLEANBREAK_APP_ORIGIN || "http://localhost:3000")
    if (
      origin.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    ) {
      dependencies.output(
        "Live developer server requires a loopback CLEANBREAK_APP_ORIGIN, such as http://localhost:3000.",
      )
      return 1
    }
    Object.assign(env, {
      CLEANBREAK_APP_ORIGIN: origin.origin,
      CLEANBREAK_REAL_PROVIDER_EXECUTOR: "desktop",
      CLEANBREAK_DRY_RUN: "false",
      CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
      CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL: "true",
      // Starting this server alone must not recover/execute old queued jobs.
      // Explicit dashboard requests still schedule their own persisted jobs.
      CLEANBREAK_CANCELLATION_WORKER: "false",
    })
    dependencies.output(
      "Live mode: use only an account you own or control. Clicking Cancel subscription authorizes one real cancellation attempt.",
    )
    if (
      !env.CLEANBREAK_OPERATOR_PASSWORD ||
      env.CLEANBREAK_OPERATOR_PASSWORD.length < 24
    ) {
      dependencies.output(
        "Choose a CleanBreak operator password (24+ characters; input is hidden):",
      )
      env.CLEANBREAK_OPERATOR_PASSWORD = await dependencies.readPassword()
    }
    if (env.CLEANBREAK_OPERATOR_PASSWORD.length < 24) {
      dependencies.output(
        "Operator password must be at least 24 characters. Server not started.",
      )
      return 1
    }
    try {
      dependencies.validate(env)
    } catch {
      dependencies.output(
        "Miro configuration is incomplete. Check provider/plan/amount/currency/interval, API keys, and the saved Desktop session. Server not started.",
      )
      return 1
    }
    dependencies.output(`Open exactly: ${origin.origin}`)
    dependencies.output(
      "Operator username: cleanbreak. Use the password you supplied. No cancellation runs until requested from the dashboard.",
    )
    return await dependencies.start(env, origin.port || "80")
  } catch {
    dependencies.output(
      "Live web startup canceled or unavailable. No cancellation was submitted by this launcher.",
    )
    return 1
  } finally {
    delete env.CLEANBREAK_OPERATOR_PASSWORD
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runLiveWeb(process.env, {
    async readPassword() {
      const signals = terminalSignals()
      try {
        return await readHiddenText(signals.signal, console.log)
      } finally {
        signals.dispose()
      }
    },
    output: console.log,
    validate: (env) => {
      productConfig("miro", env)
    },
    start: (env, port) =>
      new Promise((done) => {
        const child = spawn(
          process.execPath,
          [
            resolve("node_modules/next/dist/bin/next"),
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            port,
          ],
          {
            env,
            stdio: "inherit",
            windowsHide: true,
          },
        )
        child.once("error", () => {
          console.log(
            "Web server could not start. Stop the previous dev server and retry.",
          )
          done(1)
        })
        child.once("exit", (code) => done(code ?? 1))
      }),
  })
}
