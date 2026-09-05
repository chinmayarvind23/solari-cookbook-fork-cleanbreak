// Real local-browser product test. Isolated SQLite, loopback server, no providers.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createServer } from "node:net"
import { randomUUID } from "node:crypto"
import { chromium } from "patchright-core"
import { createDatabase } from "../lib/db"
import { productConfig } from "../lib/cancellations/config"
import { cancellationRepository } from "../lib/cancellations/repository"
import type { Job } from "../lib/cancellations/state"
import { canonicalJson } from "../lib/receipts/canonical"
import { createHash } from "node:crypto"

const directory = resolve(
  process.cwd(),
  ".cleanbreak",
  `one-click-smoke-${randomUUID()}`,
)
mkdirSync(directory, { recursive: true })
const probe = createServer()
await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done))
const port = (probe.address() as { port: number }).port
await new Promise<void>((done) => probe.close(() => done()))
const origin = `http://127.0.0.1:${port}`
const databasePath = resolve(directory, "fixture.db")
const server = spawn(
  process.execPath,
  [
    resolve("node_modules/next/dist/bin/next"),
    // Reuse an existing build to avoid taking the user's running dev-server lock.
    process.argv.includes("--production") ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CLEANBREAK_APP_ORIGIN: origin,
      CLEANBREAK_DATABASE_PATH: databasePath,
      CLEANBREAK_DRY_RUN: "true",
      CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "false",
      CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL: "false",
      CLEANBREAK_OPERATOR_PASSWORD: "",
      CLEANBREAK_CANCELLATION_WORKER: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
)
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let stage = "server_ready"
let previousJob: Job | undefined
try {
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) {
        ready = true
        break
      }
    } catch {
      /* bounded local readiness only */
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  if (!ready) throw new Error("LOCAL_SERVER_UNAVAILABLE")
  stage = "browser_launch"
  browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  })
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  })
  if (process.argv.includes("--failed-job")) {
    stage = "seed_failed_fixture_job"
    const db = createDatabase(databasePath)
    try {
      const repository = cancellationRepository(db)
      const initial = repository.create(
        productConfig("streammax", {
          ...process.env,
          CLEANBREAK_APP_ORIGIN: origin,
        }).scope,
        "fixture-previous-request",
      )
      const owner = "fixture-seed-owner"
      if (!repository.acquire(initial.id, owner))
        throw new Error("FIXTURE_SEED_FAILED")
      previousJob = repository.save(
        {
          ...initial,
          state: "FAILED",
          reason: "FINAL_BOUNDARY_NOT_ESTABLISHED",
          authorizationStatus: "EXPIRED",
        },
        owner,
      )
      repository.unlockUnclaimed(previousJob)
      repository.release(initial.id, owner)
    } finally {
      db.close()
    }
    await page.addInitScript((id) => {
      const key = "cleanbreak-cancellation-streammax"
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({ id, key: "fixture-previous-request" }),
        )
    }, previousJob.id)
  }
  stage = "dashboard"
  await page.goto(origin)
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "StreamMax", exact: true }),
  })
  stage = "initial_cancel"
  const response = page.waitForResponse(
    (r) =>
      r.url() === `${origin}/api/cancellations` &&
      r.request().method() === "POST",
  )
  await card
    .getByRole("button", {
      name: previousJob
        ? "Start a new cancellation attempt"
        : "Cancel subscription",
      exact: true,
    })
    .click()
  const started = (await (await response).json()) as { id: string }
  if (!started.id) throw new Error("AUTHORIZATION_NOT_CREATED")
  if (previousJob && started.id === previousJob.id)
    throw new Error("FAILED_JOB_REUSED")
  stage = "poll_job"
  await page.reload() // Reload must resume the same job, not authorize again.
  let result:
    | {
        state: string
        destructiveClicksExecuted: number
        authorizationUses: number
        automaticDestructiveRetries: number
        receiptUrl: string | null
      }
    | undefined
  for (let attempt = 0; attempt < 90; attempt++) {
    result = await (
      await fetch(`${origin}/api/cancellations/${started.id}`)
    ).json()
    if (
      ["VERIFIED", "FAILED", "INCONCLUSIVE", "NOT_VERIFIED"].includes(
        result!.state,
      )
    )
      break
    await new Promise((done) => setTimeout(done, 500))
  }
  if (
    result?.state !== "VERIFIED" ||
    result.destructiveClicksExecuted !== 1 ||
    result.authorizationUses !== 1 ||
    result.automaticDestructiveRetries !== 0
  )
    throw new Error("ONE_CLICK_SMOKE_FAILED")
  stage = "receipt"
  const receipt = (await (
    await fetch(`${origin}/api/cancellations/${started.id}/receipt`)
  ).json()) as { payload: unknown; digest: string }
  if (
    createHash("sha256")
      .update(canonicalJson(receipt.payload))
      .digest("hex") !== receipt.digest
  )
    throw new Error("RECEIPT_DIGEST_FAILED")
  await page.goto(`${origin}${result.receiptUrl}`)
  await page.getByRole("heading", { name: "Cancellation verified." }).waitFor()
  await page.screenshot({
    path: resolve(directory, "receipt.png"),
    fullPage: true,
  })
  writeFileSync(
    resolve(directory, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  )
  const db = createDatabase(databasePath)
  try {
    if (
      Number(
        db
          .prepare("SELECT count(*) AS count FROM one_click_authorizations")
          .get()!.count,
      ) !== (previousJob ? 2 : 1)
    )
      throw new Error("DUPLICATE_AUTHORIZATION")
    if (
      previousJob &&
      JSON.stringify(cancellationRepository(db).load(previousJob.id)) !==
        JSON.stringify(previousJob)
    )
      throw new Error("PREVIOUS_JOB_CHANGED")
  } finally {
    db.close()
  }
  console.log(
    "STREAMMAX_ONE_CLICK_OK: authorization=1 clicks=1 retries=0 verification=VERIFIED receiptDigest=valid",
  )
  if (previousJob)
    console.log(
      "FAILED_JOB_UI_RECOVERY_OK: freshAuthorization=1 previousJobPreserved=true",
    )
  console.log(`Private fixture evidence: ${directory}`)
} catch {
  console.error(
    `STREAMMAX_ONE_CLICK_FAILED: stage=${stage}; no external provider was used.`,
  )
  console.log(`Private fixture evidence: ${directory}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
}
