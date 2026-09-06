// Serve the requested private screenshot after checking its stored evidence reference.
// Serve the requested private screenshot after checking its stored evidence reference.
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
  if (!/^[0-9a-f-]{20,}$/i.test(id)) {
    return NextResponse.json(
      { error: "Invalid evidence request" },
      { status: 400 },
    )
  }
  const evidence = createAgentRepository().getVerificationEvidence(id)[0]
  const expected = `artifacts/agent/${id}/verification/account.png`
  if (
    evidence?.phase !== "VERIFICATION" ||
    evidence.screenshotPath !== expected
  ) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
  }
  try {
    const bytes = await readFile(
      resolve(
        process.cwd(),
        "artifacts",
        "agent",
        id,
        "verification",
        "account.png",
      ),
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
