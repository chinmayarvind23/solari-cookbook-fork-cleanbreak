// Inspect the local receipt layout in a browser.
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { Solari } from "@solarisdk/browser"

import { createReceiptRepository } from "@/lib/receipts/repository"
import { readSolariConfig } from "@/lib/solari/config"
import { resolveReusableProfile } from "@/lib/solari/profile"

const receipt =
  createReceiptRepository().getLatestForSubscription("sub_streammax")
if (!receipt)
  throw new Error("Visual smoke requires a persisted StreamMax receipt.")
const config = readSolariConfig(process.env)
const directory = resolve(process.cwd(), "artifacts", "receipts")
const screenshotPath = resolve(directory, `${receipt.receiptId}.png`)
mkdirSync(directory, { recursive: true })

const client = new Solari({ apiKey: config.apiKey })
let browser: Awaited<ReturnType<typeof client.launch>> | null = null
try {
  const profile = await resolveReusableProfile(client.profiles, {
    configuredId: config.profileId,
    name: config.profileName,
  })
  browser = await client.launch({
    profileId: profile.id,
    recording: true,
    stealth: config.stealth,
  })
  const page = await browser.newPage()
  const url = new URL(
    `/receipts/${receipt.receiptId}`,
    config.publicBaseUrl,
  ).toString()
  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: config.navigationTimeoutMs,
  })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(
    JSON.stringify(
      {
        receiptId: receipt.receiptId,
        url,
        pageTitle: await page.title(),
        screenshotPath,
        sessionId: browser.id,
      },
      null,
      2,
    ),
  )
} finally {
  await browser?.close().catch(() => undefined)
  await client.close().catch(() => undefined)
}
