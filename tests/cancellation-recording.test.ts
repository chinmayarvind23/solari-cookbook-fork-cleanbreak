// Regression checks for recording lifecycle and private downloads.
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { GET } from "@/app/api/cancellations/[id]/recording/route"

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
}))
vi.mock("@/lib/cancellations/repository", () => ({
  cancellationRepository: () => ({ load: mocks.load }),
}))
vi.mock("node:fs", () => ({
  readFileSync: mocks.read,
  statSync: mocks.stat,
}))
const id = "test-recording-job-1234"
let authorization: string
const context = (jobId = id) => ({ params: Promise.resolve({ id: jobId }) })
const request = (authorized = true) =>
  new Request("http://localhost:3000", {
    headers: authorized ? { authorization } : {},
  })
beforeEach(() => {
  vi.clearAllMocks()
  const credential = randomUUID()
  vi.stubEnv("CLEANBREAK_OPERATOR_PASSWORD", credential)
  vi.stubEnv("CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL", "false")
  authorization = `Basic ${Buffer.from(`cleanbreak:${credential}`).toString("base64")}`
  const bytes = Buffer.alloc(16)
  bytes.write("ftyp", 4)
  mocks.read.mockReturnValue(bytes)
  mocks.stat.mockReturnValue({ size: 16, isFile: () => true })
  mocks.load.mockReturnValue({
    recording: {
      status: "AVAILABLE",
      filename: "cancellation.mp4",
      sizeBytes: 16,
    },
  })
})
afterEach(() => vi.unstubAllEnvs())

it("requires operator authentication even when live cancellation is disabled", async () => {
  expect((await GET(request(false), context())).status).toBe(403)
  vi.stubEnv("CLEANBREAK_OPERATOR_PASSWORD", "")
  expect((await GET(request(false), context())).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
})

it("returns only the fixed private MP4 with attachment and no-store headers", async () => {
  const response = await GET(request(), context())
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
  expect(response.headers.get("Content-Type")).toBe("video/mp4")
  expect(response.headers.get("Content-Disposition")).toContain("attachment;")
  expect(mocks.read).toHaveBeenCalledWith(
    resolve(
      process.cwd(),
      "artifacts",
      "cancellations",
      id,
      "cancellation.mp4",
    ),
  )
  expect((await response.arrayBuffer()).byteLength).toBe(16)
})

it.each(["../private-data", "..%2fprivate-data", "test/id-with-slash"])(
  "rejects traversal without accessing files: %s",
  async (jobId) => {
    expect((await GET(request(), context(jobId))).status).toBe(404)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  },
)

it.each([
  { status: "RECORDING", filename: null, sizeBytes: 0 },
  { status: "FAILED", filename: null, sizeBytes: 0 },
  { status: "AVAILABLE", filename: "../private-data", sizeBytes: 16 },
])(
  "never uses a recording-supplied path or serves unfinished recordings",
  async (recording) => {
    mocks.load.mockReturnValue({ recording })
    expect((await GET(request(), context())).status).toBe(404)
    expect(mocks.read).not.toHaveBeenCalled()
  },
)

it("rejects oversized or malformed artifacts with fixed errors only", async () => {
  mocks.stat.mockReturnValueOnce({
    size: 129 * 1024 * 1024,
    isFile: () => true,
  })
  expect((await GET(request(), context())).status).toBe(404)
  expect(mocks.read).not.toHaveBeenCalled()
  mocks.read.mockReturnValueOnce(Buffer.alloc(16))
  expect((await GET(request(), context())).status).toBe(404)
  mocks.read.mockImplementationOnce(() => {
    throw new Error("private-file-error")
  })
  expect(await (await GET(request(), context())).json()).toEqual({
    error: "NOT_FOUND",
  })
})
