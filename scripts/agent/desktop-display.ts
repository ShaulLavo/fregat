import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { scriptErrors } from '../structured-errors'
import { scratchPath } from './paths'
import { outerWaylandDisplay } from './desktop-display-env'

// This fixture owns a nested compositor and session bus; it never controls the outer display.
const outerDisplay = outerWaylandDisplay(process.env)
// Hyprland's Unix control socket needs a short runtime path; artifacts keep the evidence root.
const scratch = mkdtempSync(scratchPath('g2d-'))
const home = path.join(scratch, 'home')
for (const directory of [
  home,
  `${home}/config/xdg-desktop-portal`,
  `${home}/cache`,
  `${home}/data`,
  `${home}/tmp`,
])
  mkdirSync(directory, { recursive: true, mode: 0o700 })
writeFileSync(`${home}/config/xdg-desktop-portal/portals.conf`, '[preferred]\ndefault=gtk\n')
writeFileSync(
  `${scratch}/Hyprland.conf`,
  `monitor = ,1920x1080@60,auto,1\nmisc {\n disable_hyprland_logo = true\n force_default_wallpaper = 0\n disable_autoreload = true\n}\necosystem {\n no_update_news = true\n no_donation_nag = true\n}\ndebug {\n disable_logs = false\n enable_stdout_logs = true\n}\n`,
)
const bus = `unix:path=${scratch}/bus`
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: `${home}/config`,
  XDG_CACHE_HOME: `${home}/cache`,
  XDG_DATA_HOME: `${home}/data`,
  TMPDIR: `${home}/tmp`,
  XDG_RUNTIME_DIR: scratch,
  DBUS_SESSION_BUS_ADDRESS: bus,
  GSETTINGS_BACKEND: 'memory',
  NO_AT_BRIDGE: '1',
  XDG_CURRENT_DESKTOP: 'DesktopProof',
  HYPRLAND_INSTANCE_SIGNATURE: '',
  WAYLAND_DISPLAY: outerDisplay,
  AQ_DRM_DEVICES: '/dev/null',
}
const children: {
  process: ReturnType<typeof Bun.spawn>
  name: string
  startTime: string | undefined
}[] = []
const diagnostics: Promise<unknown>[] = []
function identity(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]
  } catch {
    return undefined
  }
}
function owned(cmd: string[], name: string, inherited = false, childEnv: NodeJS.ProcessEnv = env) {
  const process = Bun.spawn({
    cmd,
    env: childEnv,
    stdout: inherited ? 'inherit' : 'pipe',
    stderr: inherited ? 'inherit' : 'pipe',
    stdin: 'ignore',
  })
  children.push({ process, name, startTime: identity(process.pid) })
  if (!inherited)
    diagnostics.push(
      Promise.all([
        new Response(process.stdout as ReadableStream<Uint8Array>)
          .text()
          .then((text) => Bun.write(`${scratch}/${name}.stdout`, text)),
        new Response(process.stderr as ReadableStream<Uint8Array>)
          .text()
          .then((text) => Bun.write(`${scratch}/${name}.stderr`, text)),
      ]),
    )
  return process
}
function control(args: string[]) {
  const signature = env.HYPRLAND_INSTANCE_SIGNATURE
  if (!signature || !existsSync(`${scratch}/hypr/${signature}/.socket.sock`))
    throw scriptErrors.INVALID_INPUT({
      message: 'The private compositor control socket is unavailable.',
      internal: { stage: 'control' },
    })
  return Bun.spawnSync(['hyprctl'].concat(args), { env })
}
let metadata: Record<string, unknown> = { scratch, compositor: 'Hyprland nested Wayland' }
try {
  // NOT-PORTABLE: Native proof requires Hyprland, DBus, GTK portals and Linux procfs.
  owned(['dbus-daemon', '--session', '--nofork', `--address=${bus}`], 'dbus')
  const compositor = owned(['Hyprland', '--config', `${scratch}/Hyprland.conf`], 'compositor')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && compositor.exitCode === null) {
    const signature = existsSync(`${scratch}/hypr`) ? readdirSync(`${scratch}/hypr`)[0] : undefined
    if (signature && existsSync(`${scratch}/hypr/${signature}/.socket.sock`)) {
      env.HYPRLAND_INSTANCE_SIGNATURE = signature
      break
    }
    await Bun.sleep(100)
  }
  const socket = readdirSync(scratch).find((file) => /^wayland-\d+$/.test(file))
  if (!socket || !env.HYPRLAND_INSTANCE_SIGNATURE)
    throw scriptErrors.INVALID_INPUT({
      message: 'The private compositor did not become ready.',
      internal: { stage: 'startup', exitCode: compositor.exitCode },
    })
  env.WAYLAND_DISPLAY = socket
  const system = control(['systeminfo']).stdout.toString()
  const monitors = JSON.parse(control(['-j', 'monitors']).stdout.toString())
  metadata = {
    ...metadata,
    signature: env.HYPRLAND_INSTANCE_SIGNATURE,
    waylandSocket: socket,
    monitors,
    system,
  }
  writeFileSync(`${scratch}/desktop-proof.json`, JSON.stringify(metadata))
  // NOT-PORTABLE: GTK portal executables are assumed at distro-specific /usr/lib paths.
  owned(['/usr/lib/xdg-desktop-portal-gtk'], 'portal-gtk')
  owned(['/usr/lib/xdg-desktop-portal'], 'portal')
  await Bun.sleep(1000)
  const arguments_ = Bun.argv.slice(2)
  const helperOnly = arguments_.includes('--native-helper-only')
  const command = arguments_.filter(
    (argument) => argument !== '--' && argument !== '--native-helper-only',
  )
  if (!command.length)
    throw scriptErrors.INVALID_INPUT({
      message: 'A verification command is required.',
      internal: { stage: 'command' },
    })
  let verificationEnv: NodeJS.ProcessEnv = env
  if (helperOnly) {
    const binary = path.resolve(
      import.meta.dirname,
      '../../apps/desktop/native/build/platform-webview',
    )
    const helper = path.join(scratch, 'native-picker')
    const keys = [
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
      'TMPDIR',
      'XDG_RUNTIME_DIR',
      'DBUS_SESSION_BUS_ADDRESS',
      'GSETTINGS_BACKEND',
      'NO_AT_BRIDGE',
      'XDG_CURRENT_DESKTOP',
      'WAYLAND_DISPLAY',
    ] as const
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const assignments = keys.map((key) => `${key}=${quote(env[key] ?? '')}`).join(' ')
    writeFileSync(helper, `#!/bin/sh\nexec /usr/bin/env ${assignments} ${quote(binary)} "$@"\n`, {
      mode: 0o700,
    })
    command.push('--file', helper)
    verificationEnv = { ...process.env }
    delete verificationEnv.WAYLAND_DISPLAY
    delete verificationEnv.DISPLAY
  }
  process.exitCode = await owned(command, 'verification', true, verificationEnv).exited
} finally {
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]!
    if (child.process.exitCode === null && identity(child.process.pid) === child.startTime)
      child.process.kill('SIGTERM')
    await Promise.race([child.process.exited, Bun.sleep(2000)])
    if (child.process.exitCode === null && identity(child.process.pid) === child.startTime) {
      child.process.kill('SIGKILL')
      await child.process.exited
    }
  }
  await Promise.allSettled(diagnostics)
  const teardown = children.map(({ process, name, startTime }) => ({
    name,
    pid: process.pid,
    startTime,
    exitCode: process.exitCode,
    signal: process.signalCode,
    procExists: existsSync(`/proc/${process.pid}`),
  }))
  writeFileSync(`${scratch}/teardown.json`, JSON.stringify({ ...metadata, teardown }, null, 2))
  console.log(`Private native display evidence: ${scratch}/teardown.json`)
}
