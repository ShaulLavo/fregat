import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { readLogs } from './logs'

import { TerminalHostClient } from '../../apps/server/src/terminal/host-client'
import { startIsolatedServer, type IsolatedServer } from './isolated-server'

it.each(['bun', 'node'])(
  'ends the isolated host and its live shell through %s before removing its home',
  async (runtime) => {
    const server = await startIsolatedServer(new URL('http://localhost:5214'))
    const client = new TerminalHostClient({ stateRoot: server.home })
    try {
      const host = await client.host()
      const shell = await client.spawn({
        key: 'cleanup',
        command: ['/bin/sh', '-c', 'sleep 60'],
        onData: () => {},
      })
      void shell.exited.catch(() => {})
      const settings = JSON.parse(readFileSync(`${server.home}/settings.json`, 'utf8'))
      expect(settings['workbench.wallpaper']).toEqual({
        enabled: false,
        source: { kind: 'desktop' },
      })
      expect(
        settings['providers.instances'].map(
          (provider: { driverKind: string; enabled: boolean }) => [
            provider.driverKind,
            provider.enabled,
          ],
        ),
      ).toEqual([
        ['codex', false],
        ['claude', false],
        ['cursor', false],
        ['opencode', false],
      ])
      const usage = await fetch(`${server.origin}/providers/usage`, {
        headers: { origin: 'http://localhost:5214' },
      })
      expect(usage.ok).toBe(true)
      expect(await usage.json()).toMatchObject({ accounts: [] })
      if (runtime === 'node') await stopHostInNode(server)
      client.close()
      await server.stop()
      await expect.poll(() => alive(host.pid), { timeout: 1_000 }).toBe(false)
      await expect.poll(() => alive(shell.pid)).toBe(false)
      expect(existsSync(server.directory)).toBe(false)
    } finally {
      client.close()
      await server.stop()
    }
  },
  40_000,
)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stopHostInNode(server: Pick<IsolatedServer, 'directory' | 'home'>) {
  const identity = new URL('../../apps/server/src/terminal-host/identity.ts', import.meta.url)
  const built = await Bun.build({ entrypoints: [identity.pathname], target: 'node' })
  expect(built.success).toBe(true)
  const output = built.outputs[0]
  assert(output)
  const module = path.join(server.directory, 'identity-node.mjs')
  await Bun.write(module, output)
  const bun = realpathSync(process.execPath)
  const node = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory) => Bun.which('node', { PATH: directory }))
    .find((candidate) => candidate !== null && realpathSync(candidate) !== bun)
  assert(node, 'A Node executable is required for the Node teardown regression')
  const child = Bun.spawn({
    cmd: [
      node,
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict'; assert.equal(process.versions.bun, undefined); const { stopTerminalHost } = await import(${JSON.stringify(pathToFileURL(module).href)}); await stopTerminalHost(process.argv[1]);`,
      server.home,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = new Response(child.stderr).text()
  expect(await child.exited, await stderr).toBe(0)
}

it('preserves accepted client events and the shutdown receipt before removing isolated state', async () => {
  const evidence = mkdtempSync(path.join(tmpdir(), 'fregat-log-tail-'))
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('OBSERVABILITY_BATCH_INTERVAL_MS', '60000')
  const since = new Date()
  let server: IsolatedServer | undefined
  try {
    server = await startIsolatedServer(new URL('http://localhost:5214'))
    const response = await fetch(`${server.origin}/_log/ingest`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5214', 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        action: 'verification.tail',
        area: 'verification',
        eventId: 'isolated-log-tail',
      }),
    })
    expect(response.status).toBe(204)
    await response.text()
    await server.stop({ logs: evidence })
    const events = await readLogs({ directory: evidence, since })
    expect(events).toContainEqual(
      expect.objectContaining({ action: 'verification.tail', level: 'warn', source: 'client' }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({ action: 'server.stop', reason: 'SIGTERM' }),
    )
    expect(existsSync(server.directory)).toBe(false)
    await server.stop()
    expect(await readLogs({ directory: evidence, since })).toEqual(events)
  } finally {
    await server?.stop()
    vi.unstubAllEnvs()
    rmSync(evidence, { recursive: true, force: true })
  }
}, 40_000)
