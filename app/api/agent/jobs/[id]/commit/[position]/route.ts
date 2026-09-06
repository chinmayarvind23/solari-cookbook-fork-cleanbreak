// Apply the supervised Browser approval to the exact saved action.
// Apply the supervised Browser approval to the exact saved action.
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

import { createAgentRepository } from "@/lib/agent/repository"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; position: string }> },
) {
  const { id, position } = await context.params
  if (!/^[0-9a-f-]{20,}$/i.test(id) || !["pre", "post"].includes(position)) {
    return NextResponse.json(
      { error: "Invalid evidence request" },
      { status: 400 },
    )
  }
  const attempt = createAgentRepository().getCommitAttempt(id)
  const storedPath =
    position === "pre"
      ? attempt?.preScreenshotPath
      : attempt?.postScreenshotPath
  const filename = position === "pre" ? "pre-click.png" : "post-click.png"
  const expected = `artifacts/agent/${id}/commit/${filename}`
  if (storedPath !== expected) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
  try {
    const bytes = await readFile(
      resolve(process.cwd(), "artifacts", "agent", id, "commit", filename),
    )
    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "image/png",
      },
    })
  } catch {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
}
