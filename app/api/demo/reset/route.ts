// Reset the fictional provider while preserving real cancellation history.
// Reset the fictional provider while preserving real cancellation history.
import { NextResponse } from "next/server"

import { isDemoScenario } from "@/lib/demo"
import { resetDemo } from "@/lib/db"

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  const scenario = contentType.includes("application/json")
    ? ((await request.json()) as { scenario?: unknown }).scenario
    : (await request.formData()).get("scenario")

  if (!isDemoScenario(scenario)) {
    return NextResponse.json(
      { error: "Unknown demo scenario" },
      { status: 400 },
    )
  }

  return NextResponse.json(resetDemo(scenario))
}
