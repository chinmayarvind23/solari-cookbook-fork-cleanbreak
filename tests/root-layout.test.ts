import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}))
import RootLayout from "@/app/layout"

it("limits extension attribute hydration suppression to the root html element", () => {
  const child = createElement("button", { type: "button" }, "Test control")
  const layout = RootLayout({ children: child })
  expect(layout.type).toBe("html")
  expect(layout.props.lang).toBe("en")
  expect(layout.props.suppressHydrationWarning).toBe(true)
  const body = layout.props.children as ReactElement<{
    children: unknown
    suppressHydrationWarning?: boolean
  }>
  expect(body.type).toBe("body")
  expect(body.props.suppressHydrationWarning).toBeUndefined()
  expect(body.props.children).toBe(child)
})

it("does not hard-code extension attributes or remove server-rendered content", () => {
  const markup = renderToStaticMarkup(
    createElement(RootLayout, { children: "App content" }),
  )
  expect(markup).toContain("App content")
  expect(markup).toContain('lang="en"')
  expect(markup).not.toContain("data-foxclocks")
  expect(markup).not.toContain("suppressHydrationWarning")
})
