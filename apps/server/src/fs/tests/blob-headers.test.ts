import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function blob(files: Record<string, string>, file: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-blob-headers-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content)
  }
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
  return app.handle(
    new Request(`http://local/fs/blob?path=${encodeURIComponent(file)}`, {
      headers: { origin: TRUSTED_ORIGIN },
    }),
  )
}

test.each([
  ['page.html', '<script>parent.alert(1)</script>'],
  ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
  ['feed.xml', '<?xml version="1.0"?><root/>'],
])('%s is served sandboxed and unsniffed', async (name, content) => {
  const response = await blob({ [name]: content }, name)

  expect(response.status).toBe(200)
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-security-policy')).toBe('sandbox')
  expect(await response.text()).toBe(content)
})

test('an image or text file is unsniffed and needs no sandbox', async () => {
  const response = await blob({ 'notes.txt': 'plain' }, 'notes.txt')

  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-security-policy')).toBeNull()
})
