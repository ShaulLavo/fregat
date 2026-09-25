import { existsSync } from 'node:fs'
import { expect, it } from 'vitest'

import { TerminalHostClient } from '../../apps/server/src/terminal/host-client'
import { startIsolatedServer } from './isolated-server'

it('ends the isolated host and its live shell before removing its home', async () => {
  const server = await startIsolatedServer(new URL('http://localhost:5214'))
  const client = new TerminalHostClient({ stateRoot: server.home })
  const host = await client.host()
  const shell = await client.spawn({
    key: 'cleanup',
    command: ['/bin/sh', '-c', 'sleep 60'],
    onData: () => {},
  })
  void shell.exited.catch(() => {})
  try {
    client.close()
    await server.stop()
    await expect.poll(() => alive(host.pid), { timeout: 1_000 }).toBe(false)
    await expect.poll(() => alive(shell.pid)).toBe(false)
    expect(existsSync(server.directory)).toBe(false)
  } finally {
    client.close()
    if (alive(host.pid)) process.kill(host.pid, 'SIGTERM')
    await server.stop()
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
