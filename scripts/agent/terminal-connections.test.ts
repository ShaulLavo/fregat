import { expect, test } from 'vitest'
import { createTestTerminalHost } from '../../apps/server/src/terminal-host/testing'
import { reattachedTerminal } from './terminal-connections'

test('replayed bytes from an old viewer cannot authorize input before a fresh attachment is ready', async () => {
  const host = await createTestTerminalHost()
  const client = host.client
  const viewer = host.connect()
  const first = { ready: false, output: '' }
  const connections = [first]
  try {
    const shell = await client.spawn({
      key: 'reload-token',
      cwd: host.stateRoot,
      env: { HOME: host.stateRoot, PATH: process.env.PATH },
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
    await host.close()
  }
}, 40_000)
