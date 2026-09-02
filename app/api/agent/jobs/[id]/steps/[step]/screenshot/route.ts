import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

import { createAgentRepository } from "@/lib/agent/repository"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; step: string }> },
) {
  const { id, step } = await context.params
  const stepNumber = Number(step)
  const record = createAgentRepository()
    .getSteps(id)
    .find((item) => item.stepNumber === stepNumber)
  if (!record?.screenshotPath) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
  const expected = `artifacts/agent/${id}/step-${String(stepNumber).padStart(2, "0")}.png`
  if (record.screenshotPath !== expected) {
    return NextResponse.json(
      { error: "Invalid screenshot path" },
      { status: 400 },
    )
  }
  const artifactRoot = resolve(process.cwd(), "artifacts", "agent")
  const filename = `step-${String(stepNumber).padStart(2, "0")}.png`
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
