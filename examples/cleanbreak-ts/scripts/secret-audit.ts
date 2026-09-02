import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"

const repositoryRoot = resolve(process.cwd(), "..", "..")
const credentials = [
  process.env.SOLARI_API_KEY,
  process.env.OPENAI_API_KEY,
].filter((value): value is string => Boolean(value && value.length >= 8))

if (credentials.length === 0) {
  throw new Error("No configured credential values were available to audit.")
}

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  {
    cwd: repositoryRoot,
  },
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .map((path) => resolve(repositoryRoot, path))

const clientFiles: string[] = []
const clientRoot = resolve(process.cwd(), ".next", "static")
const visit = (directory: string) => {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if ([".js", ".json", ".map", ".css"].includes(extname(path))) {
      clientFiles.push(path)
    }
  }
}
visit(clientRoot)

const leakedFiles = [...repositoryFiles, ...clientFiles].filter((path) => {
  const content = readFileSync(path)
  return credentials.some((credential) => content.includes(credential))
})

if (leakedFiles.length > 0) {
  throw new Error(
    `Secret audit failed: configured credential text appeared in ${leakedFiles.length} tracked or client-bundle file(s).`,
  )
}

console.log(
  `Secret audit passed: 0 configured credential values found in ${repositoryFiles.length} repository files or ${clientFiles.length} client-bundle files.`,
)
