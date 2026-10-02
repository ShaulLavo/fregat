import path from 'node:path'

export const SOCKET_UNIT = 'fregat-server.socket'
export const SERVICE_UNIT = 'fregat-server.service'
export const LAUNCHD_LABEL = 'dev.fregat.server'
/** The plist's `Sockets` key the server asks launchd for. */
const LAUNCHD_SOCKET = 'Listeners'

export type UnitValues = {
  bun: string
  releaseRoot: string
  stateHome: string
  port: number
}

const MARKER = 'fregat-registration'

/** The values a registration was rendered from, so uninstall can re-render and compare it. */
function marker(values: UnitValues) {
  return `${MARKER} ${Buffer.from(JSON.stringify(values)).toString('base64url')}`
}

/**
 * The values a file this setup wrote was rendered from, or null for anything else. Only an exact
 * re-render matches, so a hand-edited or foreign file is never mistaken for ours.
 */
export function registrationValues(
  content: string,
  render: (values: UnitValues) => string,
): UnitValues | null {
  const encoded = new RegExp(`${MARKER} ([A-Za-z0-9_-]+)`).exec(content)?.[1]
  if (!encoded) return null
  try {
    const values = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as UnitValues
    return render(values) === content ? values : null
  } catch {
    return null
  }
}

/** systemd expands `%` specifiers and splits on spaces; quote and escape every value. */
function systemdQuote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`
}

function environment(values: UnitValues) {
  const root = values.releaseRoot
  return {
    NODE_ENV: 'production',
    BUN_ENV: 'production',
    FS_HOST: '127.0.0.1',
    PORT: String(values.port),
    WEB_ROOT: path.join(root, 'current', 'web'),
    PLATFORM_PRODUCTION_ROOT: root,
    PLATFORM_HOME: values.stateHome,
    OBSERVABILITY_DIR: path.join(root, 'logs'),
    PATH: `${path.dirname(values.bun)}:/usr/local/bin:/usr/bin:/bin`,
  }
}

export function renderSystemdSocket(values: UnitValues) {
  return `# ${marker(values)}
[Unit]
Description=Fregat server socket

[Socket]
ListenStream=127.0.0.1:${values.port}
Accept=no
Service=${SERVICE_UNIT}

[Install]
WantedBy=sockets.target
`
}

export function renderSystemdService(values: UnitValues) {
  const root = values.releaseRoot
  const bun = systemdQuote(values.bun)
  const env = Object.entries(environment(values))
    .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`)
    .join('\n')
  return `# ${marker(values)}
[Unit]
Description=Fregat server
Requires=${SOCKET_UNIT}
After=${SOCKET_UNIT}
# A crash loop stops after five starts in a minute; the socket stays and the next connection retries.
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
# Consumes an explicit restart approval before promoting; crashes keep the served release.
ExecStartPre=-${bun} ${systemdQuote(path.join(root, 'bin', 'promote.ts'))} ${systemdQuote(root)}
ExecStart=${bun} ${systemdQuote(path.join(root, 'current', 'server', 'index.js'))} --service=systemd-socket:${SOCKET_UNIT}
Restart=on-failure
RestartSec=250ms
# 143: Bun's exit on SIGTERM. 75: the server's exit after Restart. 78: another server owns the state.
SuccessExitStatus=143 75
RestartForceExitStatus=75
RestartPreventExitStatus=78
${env}
`
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function plistString(value: string) {
  return `<string>${xml(value)}</string>`
}

export function renderLaunchAgent(values: UnitValues) {
  const root = values.releaseRoot
  // $0 and $1 carry the paths, so no path is ever parsed as shell text.
  const script = `"$0" "$1/bin/promote.ts" "$1"; exec "$0" "$1/current/server/index.js" --launchd-socket=${LAUNCHD_SOCKET} --service=launchd:${LAUNCHD_LABEL}`
  const env = Object.entries(environment(values))
    .map(([key, value]) => `      <key>${xml(key)}</key>${plistString(value)}`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${marker(values)} -->
<plist version="1.0">
  <dict>
    <key>Label</key>${plistString(LAUNCHD_LABEL)}
    <key>ProgramArguments</key>
    <array>
      ${plistString('/bin/sh')}
      ${plistString('-c')}
      ${plistString(script)}
      ${plistString(values.bun)}
      ${plistString(root)}
    </array>
    <key>WorkingDirectory</key>${plistString(root)}
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>Sockets</key>
    <dict>
      <key>${LAUNCHD_SOCKET}</key>
      <dict>
        <key>SockNodeName</key>${plistString('127.0.0.1')}
        <key>SockServiceName</key>${plistString(String(values.port))}
        <key>SockType</key>${plistString('stream')}
        <key>SockFamily</key>${plistString('IPv4')}
      </dict>
    </dict>
    <!-- A crash or Restart (exit 75) starts again; a clean exit, including a state-home conflict, waits for the next connection. -->
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key><false/>
    </dict>
    <key>ProcessType</key>${plistString('Interactive')}
    <key>StandardOutPath</key>${plistString(path.join(root, 'logs', 'launchd.log'))}
    <key>StandardErrorPath</key>${plistString(path.join(root, 'logs', 'launchd.log'))}
  </dict>
</plist>
`
}

/** Where the registration files live for this host. */
export function registrationFiles(host: {
  platform: NodeJS.Platform
  home: string
  env: Readonly<Record<string, string | undefined>>
}) {
  // One lock for the fixed registration names, whatever state home a setup or uninstall serves.
  if (host.platform === 'darwin')
    return {
      kind: 'launchd' as const,
      plist: path.join(host.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
      lock: path.join(host.home, 'Library', 'Application Support', 'Fregat', 'registration.lock'),
    }
  const config = host.env.XDG_CONFIG_HOME || path.join(host.home, '.config')
  const directory = path.join(config, 'systemd', 'user')
  const state = host.env.XDG_STATE_HOME || path.join(host.home, '.local', 'state')
  return {
    kind: 'systemd' as const,
    socket: path.join(directory, SOCKET_UNIT),
    service: path.join(directory, SERVICE_UNIT),
    lock: path.join(state, 'fregat', 'registration.lock'),
  }
}
