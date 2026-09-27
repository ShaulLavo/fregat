import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { stageRelease } from '../../../test/factories/server-update'
import { readLiveCheck, readStagedRelease } from '../staged-release'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function productionRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-staged-release-'))
  roots.push(root)
  return root
}

it('names why nothing is staged', async () => {
  const root = await productionRoot()
  expect(readStagedRelease(null, null)).toEqual({ staged: null, reason: 'no-root' })
  expect(readStagedRelease(root, null)).toEqual({ staged: null, reason: 'absent' })

  await symlink(path.join(root, 'releases', 'deleted'), path.join(root, 'pending'))
  expect(readStagedRelease(root, null)).toEqual({ staged: null, reason: 'dangling' })

  await stageRelease(root, 'running-release')
  expect(readStagedRelease(root, 'running-release')).toEqual({
    staged: null,
    reason: 'same-as-running',
  })
})

it('reads the staged release by its directory name', async () => {
  const root = await productionRoot()
  await stageRelease(root, 'next-release')

  expect(readStagedRelease(root, 'running-release')).toEqual({
    staged: { release: 'next-release', stagedAt: expect.any(String) },
    reason: null,
  })
})

it('ignores a live-check report for a different release directory', async () => {
  const root = await productionRoot()
  const current = path.join(root, 'releases', 'current')
  await mkdir(current, { recursive: true })
  await symlink(current, path.join(root, 'current'))
  await writeFile(
    path.join(current, 'live-check.json'),
    JSON.stringify({
      release: 'other-release',
      status: 'failed',
      checkedAt: '2026-09-27T13:19:53.752Z',
      fresh: ['no successful /health response'],
    }),
  )
  expect(readLiveCheck(root)).toBeNull()
})
