import "server-only"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type Socket } from "node:net"
import type { Desktop } from "@solarisdk/desktop"

// Transport bytes, NOT a command log. Fixed loopback destination; no filesystem,
// arbitrary command, public preview port, screenshot, or credential extraction.
const PIPE = `import socket,sys,base64,threading
s=socket.create_connection(('127.0.0.1',9222),timeout=8)
s.settimeout(None)
def receive():
 try:
  while True:
   data=s.recv(16384)
   if not data: break
   sys.stdout.write(base64.b64encode(data).decode('ascii')+'\\n'); sys.stdout.flush()
 finally:
  s.close()
t=threading.Thread(target=receive,daemon=True);t.start()
try:
 while True:
  line=sys.stdin.buffer.readline(262145)
  if not line or len(line)>262144: break
  s.sendall(base64.b64decode(line.strip(),validate=True))
finally: s.close()
`
const ENDPOINT = `import urllib.request,json
r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:9222/json/version',timeout=4)
v=json.loads(r.read(16385));print(json.dumps({'endpoint':v.get('webSocketDebuggerUrl')}))
`

type Handle = Awaited<ReturnType<Desktop["commands"]["start"]>>
type VM = Pick<Desktop, "exec" | "commands" | "ports">

export async function privateDesktopCDP(vm: VM) {
  // A public bind would expose the authenticated Chrome profile. Never use it.
  const ports = (await vm.ports.list()).filter((p) => p.port === 9222)
  if (
    !ports.length ||
    ports.some((p) => !["127.0.0.1", "::1"].includes(p.addr))
  )
    throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
  let path: string
  try {
    const result = await vm.exec("python3", {
      args: ["-c", ENDPOINT],
      timeoutMs: 5000,
    })
    if (result.exitCode !== 0 || result.stdout.length > 16384) throw new Error()
    const endpoint = new URL(JSON.parse(result.stdout).endpoint)
    if (
      endpoint.protocol !== "ws:" ||
      endpoint.hostname !== "127.0.0.1" ||
      endpoint.port !== "9222" ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint.pathname)
    )
      throw new Error()
    path = endpoint.pathname
  } catch {
    throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
  }
  const token = randomBytes(32).toString("hex")
  const commands = new Set<Handle>(),
    sockets = new Set<Socket>()
  const stopping = new Map<Handle, Promise<void>>()
  const stop = (command: Handle) => {
    const existing = stopping.get(command)
    if (existing) return existing
    const result = (async () => {
      await command.kill(15).catch(() => {})
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        command.wait().catch(() => {}),
        new Promise<void>((done) => {
          timeout = setTimeout(done, 2000)
        }),
      ])
      if (timeout) clearTimeout(timeout)
      commands.delete(command)
    })()
    stopping.set(command, result)
    return result
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setTimeout(30_000, () => socket.destroy())
    let command: Handle | undefined
    socket.on("error", () => {})
    socket.once("close", () => {
      sockets.delete(socket)
      if (command) {
        void stop(command)
      }
    })
    let header = Buffer.alloc(0)
    const handshake = async (chunk: Buffer) => {
      header = Buffer.concat([header, chunk])
      if (header.length > 16384) {
        socket.destroy()
        return
      }
      const end = header.indexOf("\r\n\r\n")
      if (end < 0) return
      socket.pause()
      socket.off("data", handshake)
      const head = header.subarray(0, end).toString("ascii")
      const auth = head.match(
        /^authorization: Bearer ([a-f0-9]{64})\r?$/im,
      )?.[1]
      if (
        head.split("\r\n")[0] !== `GET ${path} HTTP/1.1` ||
        /^origin:/im.test(head) ||
        !auth ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(token))
      ) {
        socket.destroy()
        return
      }
      let pending = ""
      try {
        command = await vm.commands.start("python3", {
          args: ["-u", "-c", PIPE],
          onStderr: () => {}, // Never relay raw guest exceptions.
          onStdout(data) {
            pending += data
            if (pending.length > 262144) {
              socket.destroy()
              return
            }
            let newline: number
            while ((newline = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, newline).trim()
              pending = pending.slice(newline + 1)
              if (!/^[A-Za-z0-9+/]+={0,2}$/.test(line)) {
                socket.destroy()
                return
              }
              socket.write(Buffer.from(line, "base64"))
            }
          },
        })
        commands.add(command)
        if (socket.destroyed) {
          await stop(command)
          return
        }
        const first = Buffer.concat([
          Buffer.from(
            head
              .split("\r\n")
              .filter((line) => !/^authorization:/i.test(line))
              .join("\r\n") + "\r\n\r\n",
          ),
          header.subarray(end + 4),
        ])
        header = Buffer.alloc(0)
        let sending = command.stdin(first.toString("base64") + "\n")
        socket.on("data", (bytes: Buffer) => {
          socket.pause()
          // Ordered bounded binary transport. No raw bytes are logged or saved.
          sending = sending.then(async () => {
            for (let offset = 0; offset < bytes.length; offset += 16384)
              await command!.stdin(
                bytes.subarray(offset, offset + 16384).toString("base64") +
                  "\n",
              )
          })
          void sending.then(
            () => socket.resume(),
            () => socket.destroy(),
          )
        })
        void command.wait().then(
          () => socket.destroy(),
          () => socket.destroy(),
        )
        await sending
        socket.resume()
      } catch {
        socket.destroy()
      }
    }
    socket.on("data", handshake)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
  }
  return {
    endpoint: `ws://127.0.0.1:${address.port}${path}`,
    headers: { Authorization: `Bearer ${token}` },
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all([...commands].map(stop))
      await Promise.all(stopping.values())
      commands.clear()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
