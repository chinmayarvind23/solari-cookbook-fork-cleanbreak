// Developer CLI only. Never imported by the CleanBreak application.
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

import { Solari, type Profile, type StorageState } from "@solarisdk/browser"
import { chromium, type Browser, type Page } from "patchright-core"

export const CONFIRMATION_PROMPT =
  "Press Enter after the provider billing/subscription page is open and the account is authenticated."

type ProfileClient = {
  profiles: Pick<Solari["profiles"], "list" | "save">
  close: Solari["close"]
}
type LocalBrowser = Pick<Browser, "close"> & {
  on(event: "disconnected", listener: () => void): unknown
  off(event: "disconnected", listener: () => void): unknown
  newContext(options: { viewport: null; acceptDownloads: false }): Promise<{
    newPage(): Promise<Pick<Page, "goto">>
    storageState(): Promise<StorageState>
  }>
}
type Dependencies = {
  createClient(apiKey: string): ProfileClient
  launchBrowser(): Promise<LocalBrowser>
  confirm(signal: AbortSignal): Promise<void>
  interactive: boolean
  output(message: string): void
}
type Environment = Readonly<Record<string, string | undefined>>

function loginProviderConfig(environment: Environment) {
  const configuredUrl = environment.CLEANBREAK_REAL_PROVIDER_URL?.trim()
  if (!configuredUrl)
    return "Set CLEANBREAK_REAL_PROVIDER_URL in the repo-root .env file."
  let url: URL
  try {
    url = new URL(configuredUrl)
  } catch {
    return "CLEANBREAK_REAL_PROVIDER_URL must be a valid HTTPS URL."
  }
  if (url.protocol !== "https:")
    return "CLEANBREAK_REAL_PROVIDER_URL must use HTTPS."
  if (url.username || url.password)
    return "CLEANBREAK_REAL_PROVIDER_URL must not contain embedded username/password credentials."

  const labels: string[] = []
  for (const key of [
    "CLEANBREAK_REAL_PROVIDER_NAME",
    "CLEANBREAK_REAL_PROVIDER_PLAN_NAME",
  ] as const) {
    const raw = environment[key]
    if (!raw?.trim()) return `Set ${key} in the repo-root .env file.`
    // Display labels only: reject terminal controls/bidi spoofing and accidental
    // configured API keys, and never echo rejected values or the provider URL.
    if (
      raw.length > 160 ||
      /[\p{Cc}\p{Cf}]/u.test(raw) ||
      [environment.SOLARI_API_KEY, environment.OPENAI_API_KEY].some(
        (secret) => secret?.trim() && raw.includes(secret.trim()),
      )
    )
      return `${key} must be a short, printable, non-secret display label.`
    labels.push(raw.trim())
  }
  return { url: url.href, name: labels[0], plan: labels[1] }
}

function numericMetadata(value: unknown): number | string {
  const numeric =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
  return typeof numeric === "number" &&
    Number.isSafeInteger(numeric) &&
    numeric >= 0
    ? numeric
    : "not exposed"
}

// The profile API may return additional private fields: select safe fields only.
export function profileMetadata(profile: Profile) {
  return {
    name: profile.name,
    id: profile.id,
    version: numericMetadata(profile.version),
    sizeBytes: numericMetadata(profile.sizeBytes),
  }
}

export function waitForConfirmation(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolveConfirmation, reject) => {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const finish = (confirmed: boolean) => {
      terminal.removeAllListeners("line")
      terminal.removeAllListeners("close")
      terminal.removeAllListeners("SIGINT")
      signal.removeEventListener("abort", cancel)
      terminal.close()
      if (confirmed) resolveConfirmation()
      else reject(new Error("Manual confirmation canceled."))
    }
    const cancel = () => finish(false)
    terminal.on("line", (line) => {
      // Ignore other input without logging its content.
      if (line === "") finish(true)
    })
    terminal.once("close", cancel)
    terminal.once("SIGINT", cancel)
    signal.addEventListener("abort", cancel, { once: true })
  })
}

export async function runProfileHelper(
  args: string[],
  environment: Environment = process.env,
  dependencies: Partial<Dependencies> = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  if (args.length > 1 || (args.length === 1 && args[0] !== "--list")) {
    output("Usage: npm run profile:login OR npm run profile:list")
    return 1
  }
  const listOnly = args[0] === "--list"
  const apiKey = environment.SOLARI_API_KEY?.trim()
  const profileName = environment.SOLARI_PROFILE_NAME
  if (!apiKey || (!listOnly && !profileName?.trim())) {
    output(
      "Set SOLARI_API_KEY and (for login) SOLARI_PROFILE_NAME in the repo-root .env file.",
    )
    return 1
  }
  // Listing profiles does not require any provider/login configuration.
  const provider = listOnly ? null : loginProviderConfig(environment)
  if (typeof provider === "string") {
    output(provider)
    return 1
  }
  if (
    !listOnly &&
    !(dependencies.interactive ?? Boolean(process.stdin.isTTY))
  ) {
    output(
      "Run profile:login in an interactive terminal. Piped input cannot authorize an upload.",
    )
    return 1
  }

  const controller = new AbortController()
  const cancel = () => controller.abort()
  for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(event, cancel)
  let solari: ProfileClient | undefined
  let browser: LocalBrowser | undefined
  let exitCode = 0
  let failureMessage =
    "Solari profile lookup failed. Check the API key and service connectivity."
  try {
    solari = (
      dependencies.createClient ?? ((apiKey) => new Solari({ apiKey }))
    )(apiKey)
    const profiles = await solari.profiles.list()
    controller.signal.throwIfAborted()
    if (listOnly) {
      if (!profiles.length) output("No Solari profiles found.")
      for (const profile of profiles)
        output(JSON.stringify(profileMetadata(profile)))
    } else {
      const matches = profiles.filter((profile) => profile.name === profileName)
      if (matches.length !== 1) {
        output(
          matches.length === 0
            ? "No profile exactly matches SOLARI_PROFILE_NAME. Run npm run profile:list to check its name. No profile was created."
            : "Multiple profiles exactly match SOLARI_PROFILE_NAME. Resolve the duplicate names before login.",
        )
        exitCode = 1
      } else {
        const profile = matches[0]
        output(JSON.stringify({ name: profile.name, id: profile.id }))
        failureMessage =
          "Local Chromium could not start. Run npm run profile:install, then retry."
        browser = await (
          dependencies.launchBrowser ??
          (() =>
            chromium.launch({
              headless: false,
              handleSIGINT: false,
              handleSIGTERM: false,
              handleSIGHUP: false,
            }))
        )()
        browser.on("disconnected", cancel)
        controller.signal.throwIfAborted()
        failureMessage =
          "The local browser could not open the configured provider billing/subscription page. No upload was attempted."
        const context = await browser.newContext({
          viewport: null,
          acceptDownloads: false,
        })
        const page = await context.newPage()
        await page.goto(provider!.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        })
        controller.signal.throwIfAborted()
        output(
          `Log in and complete MFA manually in the local Chromium window. Confirm that ${provider!.plan} is visible in ${provider!.name}'s billing/subscription page.`,
        )
        output(CONFIRMATION_PROMPT)
        failureMessage =
          "Manual confirmation canceled. No upload was attempted."
        await (dependencies.confirm ?? waitForConfirmation)(controller.signal)
        controller.signal.throwIfAborted()
        failureMessage =
          "Could not read browser storage state. No upload was attempted."
        // No path, persistent context, recording, trace, or state logging.
        const storageState = await context.storageState()
        controller.signal.throwIfAborted()
        failureMessage =
          "Solari profile upload was not confirmed. Check npm run profile:list before retrying."
        const saved = await solari.profiles.save(profile.id, storageState)
        output(
          JSON.stringify({
            name: profile.name,
            id: profile.id,
            version: numericMetadata(saved.version),
            sizeBytes: numericMetadata(saved.sizeBytes),
            nonEmpty:
              typeof saved.sizeBytes === "number" && saved.sizeBytes > 0,
          }),
        )
      }
    }
  } catch {
    // SDK errors can contain response bodies, credentials, or signed URLs.
    output(failureMessage)
    exitCode = 1
  } finally {
    try {
      browser?.off("disconnected", cancel)
      await browser?.close()
    } catch {
      output(
        "Local browser cleanup failed. Close the Chromium window manually.",
      )
      exitCode = 1
    }
    try {
      await solari?.close()
    } catch {
      output("Solari client cleanup failed. Raw error details are withheld.")
      exitCode = 1
    }
    for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.off(event, cancel)
  }
  return exitCode
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runProfileHelper(process.argv.slice(2))
}
