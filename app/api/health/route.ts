import { NextResponse } from "next/server"

import { getDatabase } from "@/lib/db"

export const dynamic = "force-dynamic"

export function GET() {
  try {
    getDatabase().prepare("SELECT 1").get()
    return NextResponse.json({ status: "ok" })
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 })
  }
}
