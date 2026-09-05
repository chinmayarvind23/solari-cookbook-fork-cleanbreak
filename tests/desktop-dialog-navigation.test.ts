import { chromium } from "patchright-core"
import { expect, it } from "vitest"
import sharp from "sharp"
import { navigationProgress } from "@/lib/desktop/navigation-progress"

it("a focus-only Tab reveals clipped dialog controls when Page Down targets the background", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    })
    await page.route("**/*", (route) => route.abort())
    // Synthetic local markup only. No Next app, live provider or credentials.
    await page.setContent(`<html><body style="overflow:hidden" data-activations="0">
      <section role="dialog" aria-modal="true" style="margin:100px auto;width:600px;height:420px;overflow:auto;background:#eee">
        <h1>We're sorry to see you go</h1>
        <p>Review the plan benefits.</p><div style="height:700px"></div>
        <button id="continue">Continue to review</button>
      </section>
      <script>
        document.querySelector('button').onclick = () => {
          document.body.dataset.activations = String(Number(document.body.dataset.activations) + 1);
        };
        // Reproduce a non-scrollable background holding keyboard focus.
        document.addEventListener('keydown', event => {
          if (event.key === 'PageDown' && document.activeElement === document.body) event.preventDefault();
        });
      </script></body></html>`)
    const before = await page.screenshot()
    await page.keyboard.press("PageDown")
    expect(
      (await navigationProgress(before, await page.screenshot())).screenChanged,
    ).toBe(false)
    expect(
      await page.locator("section").evaluate((element) => element.scrollTop),
    ).toBe(0)
    await page.keyboard.press("Tab")
    expect(
      await page.locator("section").evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0)
    const button = await page.locator("button").boundingBox(),
      dialog = await page.locator("section").boundingBox()
    expect(button!.y).toBeGreaterThanOrEqual(dialog!.y)
    expect(button!.y + button!.height).toBeLessThanOrEqual(
      dialog!.y + dialog!.height,
    )
    expect(await page.locator("body").getAttribute("data-activations")).toBe(
      "0",
    )
    expect(
      (await navigationProgress(before, await page.screenshot())).screenChanged,
    ).toBe(true)
  } finally {
    await browser.close()
  }
}, 30_000)

it("treats tiny cursor drift as no progress, material movement as progress, and invalid images as failure", async () => {
  const make = (background: string, width = 400) =>
    sharp({ create: { width, height: 240, channels: 4, background } })
      .png()
      .toBuffer()
  const before = await make("white")
  const cursor = await sharp(before)
    .composite([
      {
        input: {
          create: { width: 2, height: 14, channels: 4, background: "black" },
        },
        top: 100,
        left: 100,
      },
    ])
    .png()
    .toBuffer()
  expect(await navigationProgress(before, cursor)).toMatchObject({
    screenChanged: false,
    threshold: 0.005,
  })
  expect(await navigationProgress(before, await make("black"))).toMatchObject({
    screenChanged: true,
  })
  await expect(
    navigationProgress(before, Buffer.from("invalid")),
  ).rejects.toThrow("NAVIGATION_OBSERVATION_FAILED")
  await expect(
    navigationProgress(before, await make("white", 401)),
  ).rejects.toThrow("NAVIGATION_OBSERVATION_FAILED")
})
