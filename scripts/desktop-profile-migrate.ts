// Developer-only, explicit VM-local login-state migration. No profile export,
// screenshots, password vault, history, payment database, or raw SDK diagnostics.
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DesktopClient, type Desktop } from "@solarisdk/desktop"
import { readDesktopConnection } from "@/lib/desktop/config"
import { readRealProviderConfig } from "@/lib/real-provider/config"
import { assertNoActiveJob } from "./desktop-verify"

export const MIGRATE_AUTH_LOCALLY = String.raw`import os,sys,json,pathlib,pwd,stat,signal,time,shutil
def main():
 pid=int(sys.argv[1]); tag=sys.argv[2]
 if pid<=1 or len(tag)!=36 or any(c not in '0123456789abcdef-' for c in tag): raise ValueError()
 proc=pathlib.Path('/proc')/str(pid)
 args=[v.decode('utf8','strict') for v in (proc/'cmdline').read_bytes().split(b'\0') if v]
 if any(a.startswith(('--user-data-dir','--profile-directory','--type=')) for a in args): raise ValueError()
 if (proc/'comm').read_text().strip()!='chrome': raise ValueError()
 env={}
 for pair in (proc/'environ').read_bytes().split(b'\0'):
  k,sep,v=pair.partition(b'=')
  if k in (b'HOME',b'XDG_CONFIG_HOME'): env[k.decode()]=v.decode()
 home=pathlib.Path(env.get('HOME') or pwd.getpwuid(proc.stat().st_uid).pw_dir)
 source=pathlib.Path(env.get('XDG_CONFIG_HOME') or str(home/'.config'))/'google-chrome'
 destination=pathlib.Path('/tmp/cleanbreak-chrome')
 stage=pathlib.Path('/tmp')/('cleanbreak-chrome-migration-'+tag)
 backup=pathlib.Path('/tmp')/('cleanbreak-chrome-before-'+tag)
 def safe_path(path):
  if not path.is_absolute() or '..' in path.parts: raise ValueError()
  for item in [path,*path.parents]:
   if item.is_symlink(): raise ValueError()
 for path in (home,source,destination,stage,backup): safe_path(path)
 if not source.is_relative_to(home) or source==home or not (source/'Default').is_dir(): raise ValueError()
 if stage.exists() or backup.exists(): raise ValueError()
 state=json.loads((source/'Local State').read_text())
 if state.get('profile',{}).get('last_used','Default')!='Default': raise ValueError()
 # Only auth-bearing stores and Chrome encryption/bootstrap metadata; NEVER
 # Login Data, Web Data, History, sessions/tabs, extensions, caches or downloads.
 relatives=['Local State','Default/Preferences','Default/Cookies','Default/Network/Cookies','Default/Local Storage','Default/IndexedDB','Default/Session Storage']
 selected=[]; size=0
 for relative in relatives:
  path=source/relative
  if not path.exists(): continue
  safe_path(path)
  entries=[path,*path.rglob('*')] if path.is_dir() else [path]
  for entry in entries:
   safe_path(entry)
   mode=entry.lstat().st_mode
   if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)): raise ValueError()
   if entry.is_file(): size+=entry.stat().st_size
  selected.append(relative)
 if size>512*1024*1024 or not any(r.endswith('Cookies') for r in selected): raise ValueError()
 # Graceful shutdown of this exact default-profile Chrome root. No force kill.
 os.kill(pid,signal.SIGTERM)
 stopped=False
 for i in range(40):
  time.sleep(.25)
  if not proc.exists() or (proc/'stat').read_text().split(') ',1)[1].startswith('Z '): stopped=True;break
 if not stopped: raise ValueError()
 # Ensure no new Chrome root appeared while the source was being identified.
 for item in pathlib.Path('/proc').iterdir():
  if not item.name.isdigit(): continue
  try:
   if (item/'comm').read_text().strip()=='chrome':
    other=(item/'cmdline').read_bytes().split(b'\0')
    if other[0] and not any(a.startswith(b'--type=') for a in other): raise ValueError()
  except (FileNotFoundError,ProcessLookupError,PermissionError): pass
 os.umask(0o077);stage.mkdir(mode=0o700)
 for relative in selected:
  src=source/relative; dst=stage/relative
  safe_path(src); dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  if src.is_dir(): shutil.copytree(src,dst,symlinks=False)
  else: shutil.copy2(src,dst)
 # No deletion or overwrite. Preserve any existing dedicated directory too.
 if destination.exists(): destination.rename(backup)
 stage.rename(destination)
 print(json.dumps({'migrated':True,'originalPreserved':True,'existingDedicatedPreserved':backup.exists()}))
try: main()
except Exception: print('MIGRATION_FAILED');sys.exit(2)
`

export async function migrateDesktopAuthentication(
  vm: Pick<Desktop, "process" | "exec" | "open" | "ports" | "health">,
  url: string,
  sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
) {
  const target = new URL(url)
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("INVALID_PROVIDER_URL")
  const roots = (await vm.process.list()).filter((p) => {
    const extra = p as typeof p & { comm?: string; cmdline?: string }
    return (
      (p.name ?? extra.comm) === "chrome" &&
      !(p.cmd ?? extra.cmdline ?? "").includes("--type=")
    )
  })
  if (roots.length !== 1 || !Number.isSafeInteger(roots[0].pid))
    throw new Error("DEFAULT_CHROME_NOT_IDENTIFIED")
  if (
    (
      await vm.exec("test", {
        args: ["-x", "/usr/bin/google-chrome"],
        timeoutMs: 5000,
      })
    ).exitCode !== 0
  )
    throw new Error("CHROME_UNAVAILABLE")
  if ((await vm.ports.list()).some((p) => p.port === 9222))
    throw new Error("DEBUG_PORT_ALREADY_IN_USE")
  const migrated = await vm.exec("python3", {
    args: ["-c", MIGRATE_AUTH_LOCALLY, String(roots[0].pid), randomUUID()],
    timeoutMs: 45000,
  })
  if (migrated.exitCode !== 0) throw new Error("MIGRATION_FAILED")
  let facts: { migrated?: boolean; originalPreserved?: boolean }
  try {
    facts = JSON.parse(migrated.stdout)
  } catch {
    throw new Error("MIGRATION_FAILED")
  }
  if (facts.migrated !== true || facts.originalPreserved !== true)
    throw new Error("MIGRATION_FAILED")
  await vm.open("/usr/bin/google-chrome", [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=/tmp/cleanbreak-chrome",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--new-window",
    url,
  ])
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const ports = (await vm.ports.list()).filter((p) => p.port === 9222)
    if (ports.some((p) => !["127.0.0.1", "::1"].includes(p.addr)))
      throw new Error("PUBLIC_DEBUG_PORT_REJECTED")
    if (ports.length && (await vm.health()).ready) return
  }
  throw new Error("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
}

export async function runDesktopProfileMigrate(
  args: string[],
  env = process.env,
) {
  let vm: Desktop | undefined
  try {
    if (args.length !== 1 || args[0] !== "--copy-default-auth")
      throw new Error()
    assertNoActiveJob(env)
    const config = readDesktopConnection(env)
    const provider = readRealProviderConfig({
      ...env,
      CLEANBREAK_DRY_RUN: "true",
    })
    const client = new DesktopClient({ ...config, callTimeoutMs: 50000 })
    if (
      !["ready", "running"].includes(
        (await client.get(config.desktopId)).status,
      )
    )
      throw new Error()
    vm = await client.connect(config.desktopId)
    await vm.connect()
    if (!(await vm.health()).ready) throw new Error()
    await migrateDesktopAuthentication(vm, provider.startUrl)
    console.log("VM_LOCAL_AUTH_MIGRATION_OK")
    console.log(
      "Original profile preserved. Private DOM connection ready. No screenshots sent.",
    )
    return 0
  } catch {
    console.log(
      "VM_LOCAL_AUTH_MIGRATION_UNAVAILABLE. No raw SDK details printed.",
    )
    return 2
  } finally {
    vm?.close()
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runDesktopProfileMigrate(process.argv.slice(2))
