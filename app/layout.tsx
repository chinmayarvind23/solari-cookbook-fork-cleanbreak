// Apply the shared page shell, fonts, and metadata.
// Apply the shared page shell, fonts, and metadata.
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import type { ReactNode } from "react"

import "./globals.css"

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "CleanBreak — Verified subscription cancellation",
  description:
    "Cancel subscriptions in a real browser, then verify that billing actually stopped.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Extensions such as FoxClocks add attributes before hydration. Limit this
    // escape hatch to the root element; app content must still match normally.
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  )
}
