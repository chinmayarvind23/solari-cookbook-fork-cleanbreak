// Checks subscription card layout at desktop and mobile widths.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "patchright-core"
import { expect, it } from "vitest"
import { CancellationCard } from "@/components/cancellation-card"
import { SubscriptionCard } from "@/components/subscription-card"

it("keeps subscription text readable on desktop and mobile without fixture-unavailable copy", async () => {
  const cards = renderToStaticMarkup(
    createElement(
      "div",
      { className: "subscription-grid" },
      createElement(CancellationCard, {
        provider: "miro",
        planName: "Business Trial",
        amountCents: 24000,
        currency: "USD",
        interval: "YEARLY",
        enabled: true,
      }),
      createElement(SubscriptionCard, {
        subscription: {
          id: "layout-test",
          name: "DesignPro",
          slug: "designpro",
          domain: "designpro.example",
          url: "https://designpro.example",
          amount: 24,
          currency: "USD",
          interval: "MONTHLY",
          status: "ACTIVE",
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      }),
    ),
  )
  expect(cards).not.toContain("Demo fixture unavailable")
  expect(cards).not.toContain("Demo fixture available")
  expect(cards).toContain("one irreversible")
  const css = readFileSync(resolve("app/globals.css"), "utf8")
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  })
  const directory = resolve(".cleanbreak/subscription-layout")
  mkdirSync(directory, { recursive: true })
  try {
    const page = await browser.newPage()
    // Static mock markup only; never visit the live app or start a cancellation.
    await page.route("**/*", (route) => route.abort())
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.setContent(
        `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="page-width"><h2>Active subscriptions</h2>${cards}</main></body></html>`,
      )
      const card = await page.locator(".cancellation-card").boundingBox()
      const content = await page.locator(".cancellation-content").boundingBox()
      expect(content!.width).toBeGreaterThan(card!.width * 0.8)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      expect(
        await page
          .locator(".cancellation-content")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
      await page.screenshot({
        path: resolve(directory, `subscriptions-${width}.png`),
        fullPage: true,
      })
    }
  } finally {
    await browser.close()
  }
}, 30_000)
