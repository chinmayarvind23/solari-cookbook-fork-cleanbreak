// Read a limited set of browser facts without sending page text to a model.
import "server-only"
import type { Page } from "playwright-core"

// Execute only our own static reader code; page content is never executable input.
// tsx preserves function names using __name. Supply that identity helper in a
// lexical wrapper (not window/global state), so nested readers work in the CLI
// as well as Vitest/Next. The argument remains JSON data, never interpolated code.
export function evaluateLocalDOM<Arg, Result>(
  page: Pick<Page, "evaluate">,
  reader: (argument: Arg) => Result,
  argument: Arg,
): Promise<Awaited<Result>> {
  return page.evaluate(
    `((__name) => (${reader.toString()})(${JSON.stringify(argument)}))((fn) => fn)`,
  )
}
