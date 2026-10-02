import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderLaunchAgent, renderSystemdService, renderSystemdSocket } from '../units'
import { cleanup, scratch } from './fixtures'

afterEach(cleanup)

const values = {
  bun: '/opt/bun/bin/bun',
  releaseRoot: '/home/someone/Library/Application Support/Fregat/releases',
  stateHome: '/home/someone/.platform',
  port: 3301,
}

describe('systemd units', () => {
  it('listens on one loopback stream for one service', () => {
    const socket = renderSystemdSocket(values)
    expect(socket).toContain('ListenStream=127.0.0.1:3301\n')
    expect(socket).toContain('Accept=no\n')
    expect(socket).toContain('Service=fregat-server.service\n')
    expect(socket).toContain('WantedBy=sockets.target\n')
  })

  it('quotes paths with spaces and escapes systemd specifiers', () => {
    const service = renderSystemdService({ ...values, stateHome: '/home/a%b/.platform' })
    expect(service).toContain(
      'ExecStart="/opt/bun/bin/bun" "/home/someone/Library/Application Support/Fregat/releases/current/server/index.js" --service=systemd-socket:fregat-server.socket',
    )
    expect(service).toContain('Environment="PLATFORM_HOME=/home/a%%b/.platform"')
    expect(service).toContain('RestartPreventExitStatus=78')
    expect(service).not.toContain('[Install]')
  })

  // systemd's own parser, when this machine has it: catches a unit the manager would reject.
  it.skipIf(!Bun.which('systemd-analyze'))('passes systemd-analyze verify', async () => {
    const root = scratch()
    const units = path.join(root, 'units')
    mkdirSync(units)
    const local = {
      ...values,
      bun: process.execPath,
      releaseRoot: path.join(root, 'releases'),
      stateHome: root,
    }
    writeFileSync(path.join(units, 'fregat-server.socket'), renderSystemdSocket(local))
    writeFileSync(path.join(units, 'fregat-server.service'), renderSystemdService(local))
    const result = Bun.spawnSync([
      'systemd-analyze',
      '--user',
      'verify',
      path.join(units, 'fregat-server.socket'),
      path.join(units, 'fregat-server.service'),
    ])
    expect(new TextDecoder().decode(result.stderr)).not.toMatch(
      /fregat-server\.(socket|service):\d+: /,
    )
  })
})

describe('launchd agent', () => {
  it('declares the named loopback socket and passes paths as arguments', () => {
    const plist = renderLaunchAgent(values)
    expect(plist).toContain('<key>Listeners</key>')
    expect(plist).toContain('<key>SockNodeName</key><string>127.0.0.1</string>')
    expect(plist).toContain('<key>SockServiceName</key><string>3301</string>')
    expect(plist).toContain('--launchd-socket=Listeners --service=launchd:dev.fregat.server')
    expect(plist).toContain(`<string>${values.releaseRoot}</string>`)
    expect(plist).not.toContain('RunAtLoad')
  })

  // The plist parser macOS itself uses, when present.
  it.skipIf(!Bun.which('plutil'))('passes plutil -lint', () => {
    const root = scratch()
    const file = path.join(root, 'agent.plist')
    writeFileSync(file, renderLaunchAgent({ ...values, releaseRoot: '/a & <b>' }))
    expect(Bun.spawnSync(['plutil', '-lint', file]).exitCode).toBe(0)
  })
})

it('runs a compiled launcher as Bun in both service managers', () => {
  const compiled = { ...values, bun: '/Applications/Fregat.app/Contents/MacOS/fregat' }
  expect(renderLaunchAgent(compiled)).toContain('<key>BUN_BE_BUN</key><string>1</string>')
  expect(renderSystemdService(compiled)).toContain('Environment="BUN_BE_BUN=1"')
  expect(renderLaunchAgent(values)).not.toContain('<key>BUN_BE_BUN</key>')
})
