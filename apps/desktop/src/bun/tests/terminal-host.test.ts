import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { TerminalHostClient } from '../../../../server/src/terminal/host-client'
import { stopTerminalHost } from '../../../../server/src/terminal-host/identity'
import { hostPaths } from '../../../../server/src/terminal-host/protocol'
import { DesktopTerminalHost } from '../terminal-host'

test('desktop quit ends its leased host and shells after the server detaches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'desktop-host-'))
  const home = path.join(directory, 'home')
  const lease = path.join(directory, 'lease.json')
  const desktop = new DesktopTerminalHost(home, lease)
  const server = new TerminalHostClient({ stateRoot: home })
  try {
    await desktop.start()
    const host = await server.host()
    expect(JSON.parse(await readFile(lease, 'utf8'))).toEqual([
      expect.objectContaining({ name: 'terminal-host', pid: host.pid, target: 'process' }),
    ])
    const shell = await server.spawn({
      key: 'desktop',
      command: ['/bin/sh', '-c', 'sleep 60'],
      onData: () => {},
    })
    void shell.exited.catch(() => {})
    server.close()
    expect(() => process.kill(shell.pid, 0)).not.toThrow()
    await desktop.stop()
    expect(() => process.kill(shell.pid, 0)).toThrow()
    await expect(readFile(lease, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    server.close()
    await stopTerminalHost(home)
    await rm(hostPaths(home).directory, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
})
