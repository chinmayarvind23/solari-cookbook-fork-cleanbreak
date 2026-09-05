import { NextResponse, type NextRequest } from "next/server"
import { operatorAllowed } from "@/lib/cancellations/security"
export function proxy(request: NextRequest) {
  if (!operatorAllowed(request.headers))
    return new NextResponse("Operator authentication required.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="CleanBreak", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    })
  return NextResponse.next()
}
export const config = {
  matcher: ["/", "/api/cancellations/:path*", "/cancellations/:path*"],
}
