import { chromium } from "patchright-core"
import { expect, it, vi } from "vitest"
import {
  authorizeDesktopNavigation,
  desktopDecisionSchema,
} from "@/lib/desktop/decision"
import { navigationProgress } from "@/lib/desktop/navigation-progress"
import { executeNavigation, type DesktopHandle } from "@/lib/desktop/runtime"

it("an authorized scrollbar drag reveals clipped dialog controls without activating them", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    // Patchright normally hides headless scrollbars, preventing native input.
    ignoreDefaultArgs: ["--hide-scrollbars"],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    })
    await page.route("**/*", (route) => route.abort())
    // A real native scrollbar on synthetic local markup: no provider or app.
    // Its fixed dimensions make the observed thumb geometry deterministic.
    await page.setContent(`<html><head><style>
      body { margin:0; overflow:hidden; background:#888; }
      section { position:absolute; left:340px; top:120px; width:600px;
        height:420px; overflow-y:scroll; background:#eee; }
      section::-webkit-scrollbar { width:14px; }
      section::-webkit-scrollbar-track { background:#ddd; }
      section::-webkit-scrollbar-thumb { background:#555; }
      section::-webkit-scrollbar-button { display:none; }
      article { position:relative; height:650px; }
      h1 { margin:0; padding:24px; }
      p { margin:0; padding:0 24px; }
      footer { position:absolute; bottom:16px; left:24px; }
      button { height:32px; }
    </style></head><body data-activations="0" data-key-events="0">
      <section role="dialog" aria-modal="true">
        <article><h1>Review your cancellation</h1>
          <p>Review these details before choosing the next step.</p>
          <footer><button>Keep subscription</button>
            <button id="continue">Continue to review</button></footer>
        </article>
      </section>
      <script>
        document.querySelectorAll('button').forEach(button => {
          button.onclick = () => {
            document.body.dataset.activations = String(Number(document.body.dataset.activations) + 1);
          };
        });
        document.addEventListener('keydown', () => {
          document.body.dataset.keyEvents = String(Number(document.body.dataset.keyEvents) + 1);
        });
      </script></body></html>`)
    const dialog = page.locator("section")
    const geometry = await dialog.evaluate((element) => {
      if (!(element instanceof HTMLElement))
        throw new Error("Expected an HTML dialog in the synthetic fixture")
      const box = element.getBoundingClientRect()
      return {
        left: box.right - (element.offsetWidth - element.clientWidth),
        top: box.top,
        width: element.offsetWidth - element.clientWidth,
        height: element.clientHeight,
        thumbTop: box.top,
        thumbHeight: Math.floor(
          (element.clientHeight * element.clientHeight) / element.scrollHeight,
        ),
      }
    })
    expect(geometry.width).toBe(14)
    const before = await page.screenshot()
    const initialButton = await page.locator("#continue").boundingBox()
    expect(initialButton!.y).toBeGreaterThan(geometry.top + geometry.height)
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0)

    const proposed = desktopDecisionSchema.parse({
      type: "scroll",
      x: geometry.left + geometry.width / 2,
      y: geometry.thumbTop + Math.floor(geometry.thumbHeight / 2),
      deltaY: 144,
      scrollbar: geometry,
      text: null,
      keys: null,
      targetText: "vertical scrollbar",
      visibleText:
        "The dialog has clipped bottom controls and a visible vertical scrollbar.",
      observedOrigin: "https://provider.example",
      miroObservation: null,
      destinationOrigin: null,
      pageStatus: "authenticated_provider",
      flowStage: "REVIEW",
      reasoning:
        "Drag the visible thumb down within its track to reveal the dialog controls.",
      confidence: 0.99,
      reason: null,
    })
    const grant = authorizeDesktopNavigation(
      proposed,
      "https://provider.example",
      1280,
      720,
      0.9,
    )
    expect(grant).not.toBeNull()

    const drag = vi.fn(
      async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 10 })
        await page.mouse.up()
      },
    )
    const click = vi.fn(),
      type = vi.fn(),
      press = vi.fn()
    const desktop = {
      mouse: { drag, click },
      keyboard: { type, press },
    } as unknown as DesktopHandle
    expect(await executeNavigation(desktop, grant!)).toBe("NAVIGATION_RETURNED")
    expect(drag).toHaveBeenCalledExactlyOnceWith(
      { x: proposed.x, y: proposed.y },
      { x: proposed.x, y: proposed.y! + proposed.deltaY! },
    )
    expect(
      await dialog.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(200)
    const revealedButton = await page.locator("#continue").boundingBox()
    expect(revealedButton!.y).toBeGreaterThanOrEqual(geometry.top)
    expect(revealedButton!.y + revealedButton!.height).toBeLessThanOrEqual(
      geometry.top + geometry.height,
    )
    expect(await page.locator("body").getAttribute("data-activations")).toBe(
      "0",
    )
    expect(await page.locator("body").getAttribute("data-key-events")).toBe("0")
    expect(click).not.toHaveBeenCalled()
    expect(type).not.toHaveBeenCalled()
    expect(press).not.toHaveBeenCalled()
    expect(
      (await navigationProgress(before, await page.screenshot())).screenChanged,
    ).toBe(true)

    // The successful drag consumed this grant; it cannot be dispatched again.
    expect(await executeNavigation(desktop, grant!)).toBe(
      "ACTION_NOT_DISPATCHED",
    )
    expect(drag).toHaveBeenCalledOnce()
  } finally {
    await browser.close()
  }
}, 30_000)
