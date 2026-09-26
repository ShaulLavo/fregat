import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const MIB = 1024 * 1024
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

// Bun rejects a body over 128 MiB unless the server raises the limit, so this goes over the wire.
test('a file larger than 128 MiB, under the open limit, saves', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-large-save-'))
  roots.push(root)
  await writeFile(path.join(root, 'big.txt'), 'x')
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
  app.listen({ hostname: '127.0.0.1', port: 0 })
  const port = app.server?.port
  if (!port) throw new TypeError('The test server did not listen')
  const content = 'line of text\n'.repeat(Math.ceil((130 * MIB) / 13))

  const response = await fetch(`http://127.0.0.1:${port}/fs/write`, {
    body: JSON.stringify({ content, path: 'big.txt' }),
    headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
    method: 'POST',
  })

  expect(response.status).toBe(200)
  expect((await stat(path.join(root, 'big.txt'))).size).toBe(content.length)
}, 60_000)
