import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createTestSettingsSession } from '../../../test/factories/session'
import { writeFrame } from '@/host/frame'
import { expect, test } from '../../../test/fixtures'

test('headless capture writes a completed frame from real server settings', async ({
  server,
  client,
}) => {
  const session = createTestSettingsSession(server, { client })
  const framePath = path.join(server.root, 'capture', 'settings.txt')
  const ready = await writeFrame({
    session,
    path: framePath,
    width: 100,
    height: 30,
    noColor: true,
  })
  const frame = await readFile(framePath, 'utf8')
  expect(ready).toBe(true)
  expect(frame).toContain('Live')
  expect(frame).toContain('PLATFORM  workspace')
  expect(frame).toContain('Add project')
  expect(frame).not.toContain('Connecting to Platform')
  expect(frame.split('\n').filter(Boolean)).toHaveLength(30)
})
