import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { FsError } from '../errors'
import { createWorkspacePaths, isOutsideRoot } from '../path'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace containment', () => {
  it('reads a root-level file whose name begins with two dots', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, '..foo'), 'contents\n')

    const response = await testApp(root).handle(
      new Request('http://local/fs/read?path=..foo', { headers: trustedOriginHeaders() }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: 'contents\n', path: '..foo' })
  })

  it('lists a root-level directory whose name begins with two dots', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, '..bar'), { recursive: true })
    await writeFile(path.join(root, '..bar/child.txt'), 'child\n')

    const response = await testApp(root).handle(
      new Request('http://local/fs/tree?path=..bar&depth=1', { headers: trustedOriginHeaders() }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ path: '..bar' })
  })

  it('treats the same name identically one directory deeper', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'a'), { recursive: true })
    await writeFile(path.join(root, 'a/..baz'), 'deep\n')

    const response = await testApp(root).handle(
      new Request('http://local/fs/read?path=a/..baz', { headers: trustedOriginHeaders() }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: 'deep\n', path: 'a/..baz' })
  })

  it('still refuses paths that leave the workspace', async () => {
    const root = await fixtureRoot()
    const paths = createWorkspacePaths(root)

    for (const input of ['..', '../outside', '../..', '/etc/hosts', 'a/../../outside']) {
      expect(() => paths.resolve(input)).toThrow(FsError)
    }
  })

  it('does not let workspace index activation widen the filesystem boundary', async () => {
    const root = await fixtureRoot()
    const app = testApp(root)

    for (const input of ['../outside', '/etc']) {
      const response = await app.handle(
        new Request('http://local/fs/workspace-root', {
          body: JSON.stringify({ path: input }),
          headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
          method: 'POST',
        }),
      )

      expect(response.status).toBe(403)
    }

    const health = await app.handle(
      new Request('http://local/health', { headers: trustedOriginHeaders() }),
    )
    expect(await health.json()).toMatchObject({ workspaceIndexes: [] })
  })

  it('classifies relative paths as inside or outside the root', () => {
    const outside = ['..', `..${path.sep}x`, path.resolve(path.sep, 'etc')]
    const inside = ['', '..foo', `a${path.sep}..b`, '...', 'a.txt']

    expect(outside.map(isOutsideRoot)).toEqual([true, true, true])
    expect(inside.map(isOutsideRoot)).toEqual([false, false, false, false, false])
  })
})

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-containment-'))
  roots.push(root)
  return root
}

function testApp(root: string) {
  return createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
}

function trustedOriginHeaders(headers: HeadersInit = {}) {
  return { ...headers, origin: TRUSTED_ORIGIN }
}
