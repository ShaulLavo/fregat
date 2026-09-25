import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { stageRelease } from '../../../test/factories/server-update'
import { readStagedRelease } from '../staged-release'

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
