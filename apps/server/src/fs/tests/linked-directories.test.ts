import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { linkedDirectories, outermostTargets } from '../linked-directories'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('finds directories linked in from outside and nothing inside packages', async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-linked-scan-')))
  roots.push(base)
  const root = path.join(base, 'app')
  for (const directory of [
    'app/packages',
    'app/node_modules/@scope',
    'app/node_modules/registry/node_modules',
    'app/.git',
    'app/src',
    'outside/editor/packages/core',
    'outside/tool',
    'outside/scoped',
    'outside/buried',
  ]) {
    await mkdir(path.join(base, directory), { recursive: true })
  }
  await symlink('../../outside/editor/packages/core', path.join(root, 'packages/core'))
  await symlink('../../outside/tool', path.join(root, 'node_modules/tool'))
  await symlink('../../../outside/scoped', path.join(root, 'node_modules/@scope/scoped'))
  await symlink(
    '../../../../outside/buried',
    path.join(root, 'node_modules/registry/node_modules/b'),
  )
  await symlink('../../outside/editor', path.join(root, '.git/editor'))
  await symlink('../src', path.join(root, 'packages/inside'))

  const links = await linkedDirectories(root)

  expect(links).toEqual([
    {
      link: path.join(root, 'node_modules/@scope/scoped'),
      target: path.join(base, 'outside/scoped'),
    },
    { link: path.join(root, 'node_modules/tool'), target: path.join(base, 'outside/tool') },
    {
      link: path.join(root, 'packages/core'),
      target: path.join(base, 'outside/editor/packages/core'),
    },
  ])
})

it('watches a target inside another target once', () => {
  expect(
    outermostTargets([
      { link: '/app/a', target: '/editor/packages/core' },
      { link: '/app/b', target: '/editor' },
      { link: '/app/c', target: '/tool' },
    ]),
  ).toEqual(['/editor', '/tool'])
})
