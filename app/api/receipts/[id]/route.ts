import { NextResponse } from "next/server"

import { createReceiptRepository } from "@/lib/receipts/repository"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!/^cbr_[a-f0-9]{24}$/.test(id)) {
    return NextResponse.json(
      { error: "Invalid receipt request" },
      { status: 400 },
    )
  }
  const receipt = createReceiptRepository().getById(id)
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 })
  }
  const download = new URL(request.url).searchParams.get("download") === "1"
  return new NextResponse(JSON.stringify(receipt, null, 2), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-CleanBreak-SHA256": receipt.sha256,
      ...(download
        ? {
            "Content-Disposition": `attachment; filename="${receipt.receiptId}.json"`,
          }
        : {}),
    },
  })
}
