// Generate small artificial images for deterministic screenshot checks.
import sharp from "sharp"

// Synthetic non-secret image, generated in memory; no real desktop fixture.
const width = 400,
  height = 240
const pixels = Buffer.alloc(width * height * 3)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3
    pixels[i] = x % 256
    pixels[i + 1] = y % 256
    pixels[i + 2] = (x + y) % 256
  }
export const renderImage = await sharp(pixels, {
  raw: { width, height, channels: 3 },
})
  .png({ compressionLevel: 0 })
  .toBuffer()
