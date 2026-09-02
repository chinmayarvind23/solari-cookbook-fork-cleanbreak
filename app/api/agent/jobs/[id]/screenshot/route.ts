import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

import { createAgentRepository } from "@/lib/agent/repository"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const job = createAgentRepository().getJob(id)
  if (!job?.latestScreenshotPath) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
  const prefix = `artifacts/agent/${id}/`
  if (!job.latestScreenshotPath.startsWith(prefix)) {
    return NextResponse.json(
      { error: "Invalid screenshot path" },
      { status: 400 },
    )
  }
  const filename = job.latestScreenshotPath.slice(prefix.length)
  if (!/^step-\d{2}\.png$/.test(filename)) {
    return NextResponse.json(
      { error: "Invalid screenshot path" },
      { status: 400 },
    )
  }
  const artifactRoot = resolve(process.cwd(), "artifacts", "agent")
  try {
    return new NextResponse(
      await readFile(resolve(artifactRoot, id, filename)),
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "image/png",
        },
      },
    )
  } catch {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
}
