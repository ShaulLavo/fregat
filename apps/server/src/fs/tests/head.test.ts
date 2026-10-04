import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('filesystem head', () => {
  it('returns a short file whole', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'short.ts'), 'export {}\n')

    expect(await head(root, 'short.ts', 64)).toMatchObject({
      status: 200,
      body: {
        path: 'short.ts',
        content: 'export {}\n',
        size: 10,
        truncated: false,
        capture: {
          device: expect.any(String),
          inode: expect.any(String),
          size: 10,
          mtimeNs: expect.any(String),
          ctimeNs: expect.any(String),
        },
        coverage: {
          kind: 'complete',
          version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          bytesRead: 10,
          decodedBytes: 10,
          utf16Length: 10,
          encoding: 'utf8',
          lossy: false,
          lineTrimmed: false,
        },
      },
    })
  })

  it('stops at the last whole line inside the budget and reports the full size', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'long.txt'), 'ééé\nsecond line\nthird\n')

    const { body } = await head(root, 'long.txt', 12)
    expect(body).toMatchObject({
      path: 'long.txt',
      content: 'ééé\n',
      size: 25,
      truncated: true,
      coverage: {
        kind: 'partial',
        bytesRead: 12,
        decodedBytes: 7,
        utf16Length: 4,
        encoding: 'utf8',
        lossy: false,
        lineTrimmed: true,
      },
    })
  })

  it('refuses binary files', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'blob.bin'), new Uint8Array([0, 1, 2, 0, 255, 0, 0, 7]))

    const { status, body } = await head(root, 'blob.bin', 64)
    expect(status).toBe(415)
    expect(body).toMatchObject({ error: { code: 'FILE_IS_BINARY' } })
  })
})

async function head(root: string, file: string, maxBytes: number) {
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
  const query = new URLSearchParams({ path: file, maxBytes: String(maxBytes) })
  const response = await app.handle(
    new Request(`http://local/fs/head?${query}`, { headers: { origin: TRUSTED_ORIGIN } }),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'fs-head-'))
  roots.push(root)
  return root
}
