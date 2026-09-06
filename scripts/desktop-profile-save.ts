// Explicit developer-only authenticated state refresh; NEVER generic cleanup.
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { Solari } from "@solarisdk/browser"
import { chromium, type BrowserContext, type Page } from "playwright-core"
import { readDesktopConnection } from "@/lib/desktop/config"
import { privateDesktopCDP } from "@/lib/desktop/private-cdp"
import { evaluateLocalDOM } from "@/lib/desktop/local-dom"
import { isMiroProvider } from "@/lib/desktop/miro"
import { assertNoActiveJob } from "./desktop-verify"

export async function authenticatedMiroBilling(page: Page, expected: string) {
  return evaluateLocalDOM(
    page,
    (expected) => {
      const actual = new URL(location.href),
        configured = new URL(expected)
      const visible = (n: Element) =>
        !!n.getClientRects().length &&
        getComputedStyle(n).visibility !== "hidden"
      return (
        actual.origin === "https://miro.com" &&
        actual.origin === configured.origin &&
        actual.pathname.replace(/\/$/, "") ===
          configured.pathname.replace(/\/$/, "") &&
        !actual.search &&
        !actual.hash &&
        !actual.username &&
        !actual.password &&
        !document.querySelector('input[type="password"]') &&
        // A known Miro cancellation dialog does not discard established login;
        // unknown/login/challenge dialogs can never authorize state persistence.
        Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter(visible)
          .every(
            (dialog) =>
              !!dialog.querySelector(
                '[data-testid="open-format-feedback__textarea"]',
              ) &&
              !!dialog.querySelector(
                '[data-testid="open-format-feedback__submit-btn"]',
              ),
          ) &&
        Array.from(
          document.querySelectorAll('[data-testid="billing-container"]'),
        ).filter(visible).length === 1 &&
        Array.from(
          document.querySelectorAll(
            '[data-testid="billing-overview__plan-details"]',
          ),
        ).filter(visible).length === 1 &&
        Array.from(
          document.querySelectorAll(
            '[data-testid="billing-overview__next-events"]',
          ),
        ).filter(visible).length === 1
      )
    },
    expected,
  )
}

export async function saveAuthenticatedDesktopProfile(
  solari: Pick<Solari, "profiles">,
  context: Pick<BrowserContext, "storageState">,
  name: string,
  authenticated: () => Promise<boolean>,
  stage: (stage: string) => void = () => {},
) {
  stage("profile_lookup")
  const matches = (await solari.profiles.list()).filter((p) => p.name === name)
  if (matches.length !== 1) throw new Error("EXACT_PROFILE_REQUIRED")
  stage("auth_check")
  if (!(await authenticated()))
    throw new Error("AUTHENTICATED_PROVIDER_REQUIRED")
  let state: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined
  try {
    stage("storage_state")
    state = await context.storageState({ indexedDB: true }) // In memory; no path.
    if (!state.cookies.length || !(await authenticated()))
      throw new Error("AUTHENTICATED_PROVIDER_REQUIRED")
    stage("profile_save")
    const result = await solari.profiles.save(matches[0].id, state)
    return {
      name: matches[0].name,
      id: matches[0].id,
      version: result.version,
      sizeBytes: result.sizeBytes,
    }
  } finally {
    state = undefined
  }
}

export async function runDesktopProfileSave(env = process.env) {
  let stage = "connect"
  let vm: Desktop | undefined, solari: Solari | undefined
  let bridge: Awaited<ReturnType<typeof privateDesktopCDP>> | undefined
  try {
    assertNoActiveJob(env)
    const cfg = readDesktopConnection(env),
      url = env.CLEANBREAK_REAL_PROVIDER_URL ?? "",
      name = env.SOLARI_PROFILE_NAME ?? ""
    if (!isMiroProvider(env.CLEANBREAK_REAL_PROVIDER_NAME ?? "", url) || !name)
      throw new Error()
    const client = new DesktopClient({ ...cfg, callTimeoutMs: 10000 })
    if (
      !["ready", "running"].includes((await client.get(cfg.desktopId)).status)
    )
      throw new Error()
    vm = await client.connect(cfg.desktopId)
    await vm.connect()
    bridge = await privateDesktopCDP(vm)
    const browser = await chromium.connectOverCDP(bridge.endpoint, {
      headers: bridge.headers,
      noDefaults: true,
      timeout: 10000,
    })
    const context = browser.contexts()[0]
    stage = "billing_navigation"
    // Explicitly refresh from an already authenticated, recognized Billing tab.
    // Never create an alternate login or assume a loading tab is authenticated.
    const candidates = context
      .pages()
      .filter((p) => p.url().replace(/\/$/, "") === url.replace(/\/$/, ""))
    let selected: Page | undefined
    for (const candidate of candidates)
      if (await authenticatedMiroBilling(candidate, url)) {
        if (selected) throw new Error("AMBIGUOUS_BILLING_TAB")
        selected = candidate
      }
    if (!selected) throw new Error("AUTHENTICATED_PROVIDER_REQUIRED")
    solari = new Solari({ apiKey: cfg.apiKey })
    const saved = await saveAuthenticatedDesktopProfile(
      solari,
      context,
      name,
      () => authenticatedMiroBilling(selected!, url),
      (next) => {
        stage = next
      },
    )
    console.log(JSON.stringify(saved))
    return 0
  } catch {
    console.log(
      `DESKTOP_PROFILE_SAVE_UNCONFIRMED: ${stage}. Check profile:list before retrying. Raw state and SDK errors withheld.`,
    )
    return 2
  } finally {
    try {
      await bridge?.close()
    } finally {
      try {
        vm?.close()
      } finally {
        await solari?.close().catch(() => {})
      }
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runDesktopProfileSave()
