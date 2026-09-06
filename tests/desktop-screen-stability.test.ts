// Checks pixel drift and protected click targets.
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  screenStability,
  CLICK_TARGET_PADDING,
} from "@/lib/desktop/screen-stability"

async function screenshot(
  changed = 0,
  difference = 255,
  width = 100,
  height = 100,
  startPixel = 0,
) {
  const pixels = Buffer.alloc(width * height * 4, 255)
  for (let pixel = startPixel; pixel < startPixel + changed; pixel++)
    pixels[pixel * 4] -= difference
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}

describe("deterministic pre-dispatch visual stability", () => {
  it("passes identical decoded RGBA pixels even with different PNG compression", async () => {
    const original = await screenshot()
    const reencoded = await sharp(original)
      .png({ compressionLevel: 0 })
      .toBuffer()
    expect(original.equals(reencoded)).toBe(false)
    expect(await screenStability(original, reencoded)).toMatchObject({
      stable: true,
      changedPixelRatio: 0,
      reason: "STABLE",
    })
  })
  it.each([1, 20, 50])(
    "passes %s changed pixels up to the inclusive 0.5%% limit",
    async (count) => {
      expect(
        await screenStability(await screenshot(), await screenshot(count)),
      ).toMatchObject({
        stable: true,
        changedPixelRatio: count / 10_000,
        threshold: 0.005,
      })
    },
  )
  it.each([51, 2000, 10_000])(
    "blocks %s materially changed pixels",
    async (count) => {
      expect(
        await screenStability(await screenshot(), await screenshot(count)),
      ).toMatchObject({
        stable: false,
        changedPixelRatio: count / 10_000,
        reason: "PIXEL_DRIFT",
      })
    },
  )
  it("uses a strict per-channel difference threshold of 16", async () => {
    expect(
      await screenStability(await screenshot(), await screenshot(10_000, 16)),
    ).toMatchObject({ stable: true, changedPixelRatio: 0 })
    expect(
      await screenStability(await screenshot(), await screenshot(10_000, 17)),
    ).toMatchObject({ stable: false, changedPixelRatio: 1 })
  })
  it("allows a small animation outside the click target", async () => {
    expect(
      await screenStability(await screenshot(), await screenshot(20), {
        x: 75,
        y: 75,
      }),
    ).toMatchObject({ stable: true, targetChanged: false })
  })
  it.each([0, CLICK_TARGET_PADDING])(
    "blocks even one changed pixel within the padded click box at offset %s",
    async (offset) => {
      expect(
        await screenStability(
          await screenshot(),
          await screenshot(1, 255, 100, 100, 50 * 100 + 50 + offset),
          { x: 50, y: 50 },
        ),
      ).toMatchObject({
        stable: false,
        changedPixelRatio: 0.0001,
        targetChanged: true,
        reason: "TARGET_CHANGED",
      })
    },
  )
  it("clips the target guard naturally at screen edges", async () => {
    expect(
      await screenStability(await screenshot(), await screenshot(1), {
        x: 0,
        y: 0,
      }),
    ).toMatchObject({ stable: false, targetChanged: true })
  })
  it("blocks dimension changes even with the same pixel count", async () => {
    expect(
      await screenStability(
        await screenshot(),
        await screenshot(0, 255, 200, 50),
      ),
    ).toMatchObject({
      stable: false,
      changedPixelRatio: null,
      reason: "DIMENSIONS_CHANGED",
    })
  })
  it.each(["original", "fresh"])(
    "fails closed on %s decode errors without retaining image data",
    async (side) => {
      const valid = await screenshot()
      const invalid = Buffer.from(
        "invalid image, never include this in evidence",
      )
      const result = await screenStability(
        side === "original" ? invalid : valid,
        side === "fresh" ? invalid : valid,
      )
      expect(result).toEqual({
        changedPixelRatio: null,
        threshold: 0.005,
        channelThreshold: 16,
        targetPadding: null,
        targetChanged: false,
        stable: false,
        reason: "DECODE_FAILED",
      })
    },
  )
})
