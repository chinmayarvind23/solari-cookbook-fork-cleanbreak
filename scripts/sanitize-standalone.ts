// Next deliberately copies .env into standalone output. Runtime secrets/state
// must be injected separately, not shipped with a CleanBreak deployment bundle.
import {
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { resolve, sep, relative, dirname } from "node:path"
const root = resolve(process.cwd(), ".next", "standalone")
// Instrumentation traces do not honor route-level tracing exclusions. Filter
// generated manifests too, so later deployment tooling cannot re-copy state.
function sanitizeTraces(directory: string, workspace: string) {
  if (!existsSync(directory)) return
  if (
    lstatSync(directory).isSymbolicLink() ||
    !realpathSync(directory).startsWith(resolve(workspace, ".next") + sep)
  )
    throw new Error("UNSAFE_BUILD_TRACE_PATH")
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("UNSAFE_BUILD_TRACE_PATH")
    const file = resolve(directory, entry.name)
    if (entry.isDirectory()) sanitizeTraces(file, workspace)
    else if (entry.name.endsWith(".nft.json")) {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as {
        files: string[]
      }
      manifest.files = manifest.files.filter((value) => {
        const top = relative(workspace, resolve(dirname(file), value)).split(
          sep,
        )[0]
        return (
          ![".cleanbreak", "artifacts", "data", ".env"].includes(top) &&
          !top.startsWith(".env.")
        )
      })
      writeFileSync(file, JSON.stringify(manifest))
    }
  }
}
sanitizeTraces(resolve(process.cwd(), ".next", "server"), process.cwd())
if (existsSync(root)) {
  if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
    throw new Error("UNSAFE_BUILD_OUTPUT_PATH")
  let removed = 0
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    ".cleanbreak",
    "artifacts",
    "data",
  ]) {
    const target = resolve(root, name)
    if (!target.startsWith(root + sep) || target === root)
      throw new Error("UNSAFE_BUILD_OUTPUT_PATH")
    if (!existsSync(target)) continue
    if (
      lstatSync(target).isSymbolicLink() ||
      !realpathSync(target).startsWith(root + sep)
    )
      throw new Error("UNSAFE_BUILD_OUTPUT_PATH")
    rmSync(target, { recursive: lstatSync(target).isDirectory(), force: false })
    removed++
  }
  console.log(
    `Standalone privacy check passed; removed ${removed} generated private-file copies. Source files unchanged.`,
  )
  sanitizeTraces(resolve(root, ".next", "server"), root)
}
