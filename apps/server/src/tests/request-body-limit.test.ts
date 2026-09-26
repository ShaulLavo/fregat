import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../test/server'
import { requestBodyLimit } from '../app'
import { testSettingsOptions } from '../settings/testing'

const MAX_TEXT_FILE_BYTES = 64 * 1024

test.each([
  ['a control character, six bytes as \\u0001', '\u0001'],
  ['a quote, two bytes', '"'],
  ['plain ASCII', 'a'],
  ['a four-byte UTF-8 character', '😀'],
])('a save of a max-size file of %s fits the body limit', (_name, unit) => {
  const unitBytes = Buffer.byteLength(unit, 'utf8')
  const content = unit.repeat(Math.floor(MAX_TEXT_FILE_BYTES / unitBytes))
  const body = JSON.stringify({ baseVersion: 'v'.repeat(64), content, path: 'a/b/file.txt' })

  expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(requestBodyLimit(MAX_TEXT_FILE_BYTES))
})

test('the server is built with the body limit its open limit implies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-body-limit-'))
  try {
    const app = createTestApp({
      maxTextFileBytes: MAX_TEXT_FILE_BYTES,
      settings: testSettingsOptions(root),
      watch: false,
      workspaceRoot: root,
    })
    expect(app.config.serve?.maxRequestBodySize).toBe(requestBodyLimit(MAX_TEXT_FILE_BYTES))
  } finally {
    await closeTestApps()
    await rm(root, { force: true, recursive: true })
  }
})
