// Developer-only read-only verification. No model, screenshots, profile export,
// cancellation dispatcher or receipt creation. Setup is explicitly opt-in.
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { readRealProviderConfig } from "@/lib/real-provider/config"
import { isMiroProvider } from "@/lib/desktop/miro"
import { digest, type ProductConfig } from "@/lib/cancellations/config"
import { verifyMiroDOM } from "@/lib/cancellations/miro-dom-verification"
import { verificationVerdict } from "@/lib/cancellations/policy"

type SetupVM = Pick<Desktop, "ports" | "process" | "exec" | "open" | "health">
export async function enablePrivateChromeDOM(
  vm: SetupVM,
  url: string,
  sleep: (ms: number) => Promise<void>,
) {
  const ports = (await vm.ports.list()).filter((p) => p.port === 9222)
  if (ports.length) {
    if (ports.some((p) => !["127.0.0.1", "::1"].includes(p.addr)))
      throw new Error("PUBLIC_DEBUG_PORT_REJECTED")
    return
  }
  if (
    (
      await vm.exec("test", {
        args: ["-x", "/usr/bin/google-chrome"],
        timeoutMs: 5000,
      })
    ).exitCode !== 0
  )
    throw new Error("CHROME_UNAVAILABLE")
  const processes = await vm.process.list()
  const roots = processes.filter((p) => {
    const extra = p as typeof p & { comm?: string; cmdline?: string }
    const name = p.name ?? extra.comm
    const args = (p.cmd ?? extra.cmdline ?? "").split(/[\0\s]+/)
    return (
      name === "chrome" &&
      Number.isSafeInteger(p.pid) &&
      p.pid > 0 &&
      args.includes("--user-data-dir=/tmp/cleanbreak-chrome") &&
      !args.some((a) => a.startsWith("--type="))
    )
  })
  if (roots.length !== 1) throw new Error("DEDICATED_CHROME_NOT_IDENTIFIED")
  // Graceful shutdown of only the positively identified dedicated Chrome root.
  // Never force-kill, delete/copy its profile, pause or destroy the Desktop.
  await vm.process.signal(roots[0].pid, 15)
  for (let i = 0; i < 10; i++) {
    await sleep(500)
    if (!(await vm.process.list()).some((p) => p.pid === roots[0].pid)) break
    if (i === 9) throw new Error("CHROME_SHUTDOWN_NOT_CONFIRMED")
  }
  await vm.open("/usr/bin/google-chrome", [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=/tmp/cleanbreak-chrome",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--new-window",
    url,
  ])
  for (let i = 0; i < 10; i++) {
    await sleep(500)
    const fresh = (await vm.ports.list()).filter((p) => p.port === 9222)
    if (fresh.length) {
      if (fresh.some((p) => !["127.0.0.1", "::1"].includes(p.addr)))
        throw new Error("PUBLIC_DEBUG_PORT_REJECTED")
      if ((await vm.health()).ready) return
    }
  }
  throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
}

export function assertNoActiveJob(env: NodeJS.ProcessEnv) {
  const path = resolve(env.CLEANBREAK_DATABASE_PATH ?? "data/cleanbreak.db")
  if (!existsSync(path)) return
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const row = db
      .prepare(
        "SELECT count(*) n FROM one_click_jobs WHERE state NOT IN ('VERIFIED','NOT_VERIFIED','INCONCLUSIVE','FAILED')",
      )
      .get()
    if (row?.n !== 0) throw new Error("ACTIVE_CANCELLATION_JOB")
  } finally {
    db.close()
  }
}

export async function runDesktopVerify(args: string[], env = process.env) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--enable-dom")) {
    console.log("Usage: npm run desktop:verify -- [--enable-dom]")
    return 1
  }
  let vm: Desktop | undefined
  try {
    assertNoActiveJob(env)
    const connection = readDesktopConnection(env)
    const provider = readRealProviderConfig({
      ...env,
      CLEANBREAK_DRY_RUN: "true",
    })
    if (!isMiroProvider(provider.providerName, provider.startUrl))
      throw new Error("MIRO_CONFIG_REQUIRED")
    const client = new DesktopClient({
      apiKey: connection.apiKey,
      baseUrl: connection.baseUrl,
      callTimeoutMs: 10000,
    })
    if (
      !["ready", "running"].includes(
        (await client.get(connection.desktopId)).status,
      )
    )
      throw new Error("DESKTOP_NOT_READY")
    vm = await client.connect(connection.desktopId)
    await vm.connect()
    if (!(await vm.health()).ready) throw new Error("DESKTOP_NOT_READY")
    const sleep = (ms: number) =>
      new Promise<void>((done) => setTimeout(done, ms))
    if (args[0] === "--enable-dom")
      await enablePrivateChromeDOM(vm, provider.startUrl, sleep)
    const config: ProductConfig = {
      env,
      startUrl: provider.startUrl,
      scope: {
        provider: "miro",
        providerOrigin: "https://miro.com",
        subscriptionKey: digest(["miro", provider.startUrl, provider.planName]),
        sessionBinding: digest(connection.desktopId),
        planName: provider.planName,
        expectedAmountCents: Math.round(provider.subscription.amount * 100),
        currency: provider.subscription.currency,
        interval: provider.subscription.interval,
        accessPolicy: "PRESERVE_PREPAID_ACCESS",
      },
    }
    const observed = await verifyMiroDOM(vm, config, randomUUID())
    // This read-only command cannot create an authorization or issue a receipt.
    const result = verificationVerdict(config.scope, observed, true)
    console.log(
      JSON.stringify({
        result,
        source: observed.evidenceKind,
        authenticated: observed.authenticated,
        identityMatched: observed.matched,
        identityChecks: observed.identityChecks,
        renewalStatus: observed.billing.renewalStatus,
        nextChargePresent: observed.billing.nextChargePresent,
        screenshotsSent: 0,
        destructiveClicksExecuted: 0,
        cancellationExecutionProven: false,
        receiptCreated: false,
      }),
    )
    return result === "INCONCLUSIVE" ? 2 : 0
  } catch (error) {
    const fixed = [
      "ACTIVE_CANCELLATION_JOB",
      "MIRO_CONFIG_REQUIRED",
      "DESKTOP_NOT_READY",
      "PRIVATE_DOM_CONNECTION_UNAVAILABLE",
      "DOM_VERIFICATION_UNAVAILABLE",
      "PUBLIC_DEBUG_PORT_REJECTED",
      "CHROME_UNAVAILABLE",
      "DEDICATED_CHROME_NOT_IDENTIFIED",
      "CHROME_SHUTDOWN_NOT_CONFIRMED",
    ]
    console.log(
      JSON.stringify({
        result: "INCONCLUSIVE",
        reason:
          error instanceof Error && fixed.includes(error.message)
            ? error.message
            : "DOM_VERIFICATION_UNAVAILABLE",
        screenshotsSent: 0,
        destructiveClicksExecuted: 0,
      }),
    )
    return 2
  } finally {
    try {
      vm?.close()
    } catch {}
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runDesktopVerify(process.argv.slice(2))
