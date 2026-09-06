// Serve the private local Desktop viewer without exposing its remote capabilities.
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// Local developer-only noVNC viewer. Remote capability URLs stay in memory and
// are never written to artifacts, HTML files, or terminal output.
export async function startDesktopViewer(streamUrl: string, viewOnly = true) {
  const stream = new URL(streamUrl)
  if (stream.protocol !== "wss:") throw new Error("DESKTOP_STREAM_UNAVAILABLE")
  const prefix = `/${randomBytes(24).toString("hex")}/`
  const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.resolve("@novnc/novnc"))),
    "..",
  )
  let recordingUrl: string | null = null
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ${stream.origin}; frame-ancestors 'none'`,
    )
    const port = (server.address() as { port: number }).port
    if (
      request.method !== "GET" ||
      request.headers.host !== `127.0.0.1:${port}` ||
      (request.headers.origin &&
        request.headers.origin !== `http://127.0.0.1:${port}`) ||
      !request.url?.startsWith(prefix)
    ) {
      response.writeHead(404).end()
      return
    }
    const route = request.url.slice(prefix.length)
    try {
      if (route === "") {
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.end(
          '<!doctype html><meta charset="utf-8"><title>CleanBreak Desktop</title><style>body{margin:0;background:#111;color:white;font:16px sans-serif}#screen{height:90vh}p{padding:8px}</style><p id="status">Connecting to the private desktop view…</p><div id="screen"></div><p><a href="recording" target="_blank" rel="noreferrer">Recording (available after stop, while this viewer is open)</a></p><script type="module" src="viewer.js"></script>',
        )
      } else if (route === "viewer.js") {
        response.setHeader("Content-Type", "text/javascript")
        response.end(`import RFB from './novnc/core/rfb.js';
const settings = await (await fetch('./session', {cache:'no-store'})).json();
const rfb = new RFB(document.getElementById('screen'), settings.streamUrl);
rfb.viewOnly = settings.viewOnly; rfb.scaleViewport = true; rfb.resizeSession = false;
rfb.addEventListener('connect', () => { document.getElementById('status').textContent = settings.viewOnly ? 'Read-only live view. Review navigation in the terminal.' : 'Manual authentication only. Return to the terminal when finished.'; });
rfb.addEventListener('disconnect', () => { document.getElementById('status').textContent = 'Desktop disconnected or paused.'; });
window.addEventListener('pagehide', () => rfb.disconnect());`)
      } else if (route === "session") {
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({ streamUrl, viewOnly }))
      } else if (route === "recording" && recordingUrl) {
        response.writeHead(302, { Location: recordingUrl }).end()
      } else if (route.startsWith("novnc/") && route.endsWith(".js")) {
        const file = resolve(packageRoot, route.slice(6))
        if (!file.startsWith(packageRoot + sep)) {
          response.writeHead(404).end()
          return
        }
        response.setHeader("Content-Type", "text/javascript")
        // Developer-only assets already constrained to packageRoot above. Do not
        // let a production importer trace private workspace files through here.
        response.end(await readFile(/* turbopackIgnore: true */ file))
      } else response.writeHead(404).end()
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolveReady())
  })
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    setRecording(url: string) {
      if (new URL(url).protocol === "https:") recordingUrl = url
    },
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done())
        server.closeAllConnections()
      }),
  }
}
