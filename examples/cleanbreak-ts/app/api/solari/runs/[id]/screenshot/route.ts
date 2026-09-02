import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

import { createSolariRunRepository } from "@/lib/solari/repository"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const run = createSolariRunRepository().getById(id)
  if (!run?.screenshotPath) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }

  const artifactRoot = resolve(process.cwd(), "artifacts", "solari")
  const expectedRelativePath = `artifacts/solari/${id}.png`
  if (run.screenshotPath !== expectedRelativePath) {
    return NextResponse.json(
      { error: "Invalid screenshot path" },
      { status: 400 },
    )
  }
  const screenshotPath = resolve(artifactRoot, `${id}.png`)

  try {
    return new NextResponse(await readFile(screenshotPath), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "image/png",
      },
    })
  } catch {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
}
