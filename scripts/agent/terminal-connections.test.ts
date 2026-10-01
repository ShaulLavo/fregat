import { expect, test } from 'vitest'
import { TerminalHostClient } from '../../apps/server/src/terminal/host-client'
import { startIsolatedServer } from './isolated-server'
import { reattachedTerminal } from './terminal-connections'

test('replayed bytes from an old viewer cannot authorize input before a fresh attachment is ready', async () => {
  const server = await startIsolatedServer(new URL('http://localhost:5251'))
  const client = new TerminalHostClient({ stateRoot: server.home })
  const viewer = new TerminalHostClient({ stateRoot: server.home })
  const first = { ready: false, output: '' }
  const connections = [first]
  try {
    const shell = await client.spawn({
      key: 'reload-token',
      cwd: server.directory,
      env: { HOME: server.directory, PATH: process.env.PATH },
      command: ['/bin/sh'],
      onData: (bytes) => {
        first.output += Buffer.from(bytes).toString('utf8')
      },
    })
    first.ready = true
    shell.write(
      Buffer.from(
        'PLAN126_API_TOKEN=survives; printf "\\nAPI_BEFORE_%s\\n" "$PLAN126_API_TOKEN"\n',
      ),
    )
    await expect.poll(() => first.output).toContain('API_BEFORE_survives')
    const beforeReload = connections.length
    expect(reattachedTerminal(connections, beforeReload)).toBeUndefined()
    const replay = { ready: false, output: '' }
    connections.push(replay)
    const attached = await viewer.attach({
      key: 'reload-token',
      from: 0,
      onData: (bytes) => {
        replay.output += Buffer.from(bytes).toString('utf8')
      },
    })
    expect(reattachedTerminal(connections, beforeReload)).toBeUndefined()
    replay.ready = true
    expect(reattachedTerminal(connections, beforeReload)).toBe(replay)
    expect(attached.pid).toBe(shell.pid)
    attached.write(Buffer.from('printf "\\nAPI_AFTER_%s\\n" "$PLAN126_API_TOKEN"\n'))
    await expect.poll(() => replay.output).toContain('API_AFTER_survives')
    await expect.poll(() => first.output).toContain('API_AFTER_survives')
    attached.kill()
  } finally {
    viewer.close()
    client.close()
    await server.stop()
  }
}, 40_000)
