import { expect, test } from 'vitest'
import { parseSettingsStream } from '../write'

test('settings framing preserves event names and keeps null keepalives separate from snapshots', async () => {
  async function* events() {
    yield { event: 'heartbeat', data: null }
    yield { event: 'keepalive', data: null }
    yield { event: 'settings', data: { version: 3 } }
  }
  expect(await Array.fromAsync(parseSettingsStream(events()))).toEqual([
    { event: 'heartbeat', data: null },
    { event: 'keepalive', data: null },
    { event: 'settings', data: { version: 3 } },
  ])
})
