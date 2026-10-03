import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import setupBrowserFileServer from '../../apps/web/test/env/browser-file-server'
import { TerminalHostClient } from '../../apps/server/src/terminal/host-client'
import {
  hostIdentityMatches,
  processStart,
  readHostIdentity,
  stopTerminalHost,
} from '../../apps/server/src/terminal-host/identity'
import { launchHost } from '../../apps/server/src/terminal-host/launch'
import { hostPaths } from '../../apps/server/src/terminal-host/protocol'

it.skipIf(process.platform === 'win32').each([
  ['running', 'running'],
  ['exited', 'running'],
  ['exited', 'exited'],
])(
  'ends the shared browser fixture host and shell after its API is %s and host is %s',
  async (apiState, hostState) => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'browser-file-server-test-'))
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
    const origin = probe.url.origin
    await probe.stop(true)
    vi.stubEnv('TMPDIR', scratch)
    vi.stubEnv('VITEST_BROWSER_FILE_SERVER_URL', origin)
    let first: (() => Promise<void>) | undefined
    let last: (() => Promise<void>) | undefined
    let client: TerminalHostClient | undefined
    let home: string | undefined
    let identity: ReturnType<typeof readHostIdentity> = null
    try {
      first = await setupBrowserFileServer()
      last = await setupBrowserFileServer()
      const homes = (await readdir(scratch)).filter((name) => name.startsWith('platform-browser-'))
      expect(homes).toHaveLength(1)
      assert(homes[0])
      home = path.join(scratch, homes[0])
      let launches = 0
      client = new TerminalHostClient({
        stateRoot: home,
        launch: (argv, env) => {
          launches += 1
          return launchHost(argv, env)
        },
      })
      const host = await client.host()
      identity = readHostIdentity(hostPaths(home).manifest)
      assert(identity && identity.hostPid === host.pid)
      const shell = await client.spawn({
        key: 'fixture-cleanup',
        command: ['/bin/sh', '-c', 'sleep 60'],
        onData: () => {},
      })
      void shell.exited.catch(() => {})
      const shellStart = processStart(shell.pid)
      assert(shellStart)

      await first()
      first = undefined
      expect(existsSync(home)).toBe(true)
      expect(hostIdentityMatches(identity)).toBe(true)

      const launchesBeforeCleanup = launches
      // Detach the observer before teardown so a lost shell cannot restart its host.
      client.close()
      if (apiState === 'exited') {
        const apiPid = Number(await readFile(path.join(home, 'server.lock'), 'utf8'))
        assert(Number.isSafeInteger(apiPid) && apiPid > 1 && apiPid !== process.pid)
        const apiStart = processStart(apiPid)
        assert(apiStart)
        process.kill(apiPid, 'SIGKILL')
        await expect.poll(() => processStart(apiPid)).not.toBe(apiStart)
        expect(hostIdentityMatches(identity)).toBe(true)
      }

      if (hostState === 'exited') {
        // Abrupt loss supplies no shell-exit frame, making an attached observer reconnect.
        const hostStart = identity.processStart
        process.kill(host.pid, 'SIGKILL')
        await expect.poll(() => processStart(host.pid), { timeout: 5_000 }).not.toBe(hostStart)
        await expect.poll(() => processStart(shell.pid), { timeout: 5_000 }).not.toBe(shellStart)
      }

      await last()
      last = undefined
      expect(launches).toBe(launchesBeforeCleanup)
      expect(hostIdentityMatches(identity)).toBe(false)
      expect(processStart(shell.pid)).not.toBe(shellStart)
      expect(existsSync(hostPaths(home).directory)).toBe(false)
      expect(existsSync(home)).toBe(false)
    } finally {
      client?.close()
      if (home) await stopTerminalHost(home)
      const retained = identity
      if (retained) {
        await expect.poll(() => hostIdentityMatches(retained), { timeout: 5_000 }).toBe(false)
      }
      await last?.()
      await first?.()
      if (home) await rm(hostPaths(home).directory, { recursive: true, force: true })
      await rm(scratch, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  },
  40_000,
)
