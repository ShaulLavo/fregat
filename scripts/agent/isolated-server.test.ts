import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { readLogs } from './logs'

import { TerminalHostClient } from '../../apps/server/src/terminal/host-client'
import { startIsolatedServer, waitForHealth, type IsolatedServer } from './isolated-server'

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

it('serves supplied web assets with the isolated promoted release descriptor', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'fregat-built-web-'))
  const web = path.join(fixture, 'web')
  mkdirSync(web)
  writeFileSync(
    path.join(web, 'index.html'),
    '<!doctype html><html><head><style id="platform-palette"></style><script id="fregat-html-bootstrap" type="application/json"></script><link id="fregat-wallpaper-light"><link id="fregat-wallpaper-dark"></head><body><p>Built fixture</p></body></html>',
  )
  let server: IsolatedServer | undefined
  try {
    server = await startIsolatedServer(new URL('http://localhost:5214'), { webRoot: web })
    writeFileSync(
      path.join(server.directory, 'served', 'build-config.json'),
      JSON.stringify({ release: 'fixture-promoted', liveCheck: false }),
    )
    const release = await (await fetch(`${server.origin}/release`)).json()
    expect(release).toMatchObject({
      release: 'fixture-promoted',
      server: { release: 'fixture-promoted' },
      liveCheckRequired: false,
    })
    expect(await (await fetch(server.origin)).text()).toContain('Built fixture')
    await server.stop()
    expect(existsSync(path.join(web, 'index.html'))).toBe(true)
    expect(existsSync(path.join(fixture, 'build-config.json'))).toBe(false)
  } finally {
    await server?.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 40_000)

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

it('keeps independent concurrent callers on their own API identities and removes each home', async () => {
  const entry = new URL('./isolated-server.ts', import.meta.url).href
  const callers: Bun.Subprocess<'ignore', 'pipe', 'pipe'>[] = []
  try {
    for (let index = 0; index < 4; index += 1) {
      callers.push(
        Bun.spawn({
          cmd: [
            process.execPath,
            '--eval',
            `
          import { startIsolatedServer } from ${JSON.stringify(entry)};
          const web = new URL('http://localhost:5238');
          const server = await startIsolatedServer(web);
          try {
            const health = await (await fetch(server.origin + '/health', { headers: { origin: web.origin } })).json();
            console.log(JSON.stringify({ origin: server.origin, directory: server.directory, home: server.home, identity: health.environmentId, database: health.metadataDbPath }));
            await Bun.sleep(1500);
          } finally { await server.stop(); }
        `,
          ],
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      )
      await Bun.sleep(100)
    }
    const receipts = await Promise.all(callers.map(readCallerReceipt))
    expect(new Set(receipts.map((receipt) => receipt.origin)).size).toBe(callers.length)
    expect(new Set(receipts.map((receipt) => receipt.identity)).size).toBe(callers.length)
    for (const receipt of receipts) {
      expect(receipt.database).toBe(path.join(receipt.home, 'fs-metadata.sqlite'))
      expect(existsSync(receipt.directory)).toBe(false)
    }
  } finally {
    for (const caller of callers) if (caller.exitCode === null) caller.kill('SIGTERM')
    await Promise.all(callers.map((caller) => caller.exited))
  }
}, 40_000)

async function readCallerReceipt(caller: Bun.Subprocess<'ignore', 'pipe', 'pipe'>) {
  const stdout = new Response(caller.stdout).text()
  const stderr = new Response(caller.stderr).text()
  expect(await caller.exited, await stderr).toBe(0)
  const receipt: unknown = JSON.parse(await stdout)
  assert(typeof receipt === 'object' && receipt !== null)
  assert('origin' in receipt && typeof receipt.origin === 'string')
  assert('directory' in receipt && typeof receipt.directory === 'string')
  assert('home' in receipt && typeof receipt.home === 'string')
  assert('identity' in receipt && typeof receipt.identity === 'string')
  assert('database' in receipt && typeof receipt.database === 'string')
  return {
    origin: receipt.origin,
    directory: receipt.directory,
    home: receipt.home,
    identity: receipt.identity,
    database: receipt.database,
  }
}

it('rejects a different healthy API before sending readiness mutations and leaves it running', async () => {
  let clears = 0
  const foreign = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/terminal/clear') clears += 1
      return Response.json({ ok: true, metadataDbPath: '/other-run/fs-metadata.sqlite' })
    },
  })
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-foreign-health-'))
  const child = Bun.spawn({
    cmd: [process.execPath, '--eval', 'await Bun.sleep(500)'],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const origin = `http://127.0.0.1:${foreign.port}`
  try {
    await expect(waitForHealth(child, origin, 'http://localhost:5238', directory)).rejects.toThrow(
      'did not become healthy',
    )
    expect(clears).toBe(0)
    expect((await fetch(`${origin}/health`)).ok).toBe(true)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.exited
    foreign.stop(true)
    rmSync(directory, { recursive: true, force: true })
  }
})

it('sends no readiness mutation when the owned child exits during a matching health response', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-delayed-health-'))
  const child = Bun.spawn({
    cmd: [process.execPath, '--eval', 'await Bun.sleep(100)'],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  let healthCalls = 0
  let clears = 0
  const foreign = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/terminal/clear') {
        clears += 1
        return Response.json({ ok: true })
      }
      healthCalls += 1
      if (healthCalls === 1) {
        await child.exited
        return Response.json({
          ok: true,
          metadataDbPath: path.join(directory, 'home', 'fs-metadata.sqlite'),
        })
      }
      return Response.json({ ok: true, metadataDbPath: '/foreign-run/fs-metadata.sqlite' })
    },
  })
  const origin = `http://127.0.0.1:${foreign.port}`
  try {
    await expect(waitForHealth(child, origin, 'http://localhost:5238', directory)).rejects.toThrow(
      'did not become healthy',
    )
    expect(child.exitCode).toBe(0)
    expect(clears).toBe(0)
    expect((await fetch(`${origin}/health`)).ok).toBe(true)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.exited
    foreign.stop(true)
    rmSync(directory, { recursive: true, force: true })
  }
})
