// Developer CLI only. Never imported by the CleanBreak application.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { Solari, type Profile } from "@solarisdk/browser"

export const MANUAL_LOGIN_LIMITATION =
  "Manual login unavailable with the installed @solarisdk/browser 0.1.3: " +
  "BrowserSession exposes wsEndpoint/cdpEndpoint for protocol clients, " +
  "but no live/debug/stream/view URL for interactive browser use. " +
  "getReplayUrl() is a recording download after session release, not an interactive editor. " +
  "Solari documents Console > Profiles > Open editor; if that control is missing, " +
  "ask Solari to enable or restore it. No browser was launched and no profile was saved."

type ProfileClient = {
  profiles: Pick<Solari["profiles"], "list">
  close: Solari["close"]
}
type Environment = Readonly<Record<string, string | undefined>>

function numericMetadata(value: unknown): number | string {
  // The live profile API also serializes byte counts as decimal strings.
  const numeric =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
  return typeof numeric === "number" &&
    Number.isSafeInteger(numeric) &&
    numeric >= 0
    ? numeric
    : "not exposed"
}

// Profile has an open-ended SDK type: explicitly select safe fields only.
export function profileMetadata(profile: Profile) {
  return {
    name: profile.name,
    id: profile.id,
    version: numericMetadata(profile.version),
    sizeBytes: numericMetadata(profile.sizeBytes),
  }
}

export async function runProfileHelper(
  args: string[],
  environment: Environment = process.env,
  createClient: (apiKey: string) => ProfileClient = (apiKey) =>
    new Solari({ apiKey }),
  output: (message: string) => void = console.log,
): Promise<number> {
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

  let solari: ProfileClient | undefined
  let exitCode = 0
  try {
    solari = createClient(apiKey)
    const profiles = await solari.profiles.list()
    if (listOnly) {
      if (!profiles.length) output("No Solari profiles found.")
      for (const profile of profiles) {
        output(JSON.stringify(profileMetadata(profile)))
      }
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
        output(JSON.stringify(profileMetadata(matches[0])))
        output(MANUAL_LOGIN_LIMITATION)
        exitCode = 1
      }
    }
  } catch {
    // SDK error messages can contain HTTP response bodies and signed URLs.
    output(
      "Solari profile lookup failed. Check the API key and service connectivity. Raw error details are withheld.",
    )
    exitCode = 1
  } finally {
    try {
      await solari?.close()
    } catch {
      output("Solari client cleanup failed. Raw error details are withheld.")
      exitCode = 1
    }
  }
  return exitCode
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runProfileHelper(process.argv.slice(2))
}
