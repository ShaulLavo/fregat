import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createWorkbenchTree } from '@/tree/state/tree'
import { treeRowIcon } from '@/tree/utils/paths'
import { test, expect } from '../../../test/fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'

test('tree lazily expands directories and resolves paths against its project root', async ({
  server,
}) => {
  await mkdir(`${server.root}/project/src`, { recursive: true })
  await writeFile(`${server.root}/project/src/main.ts`, 'source')
  await writeFile(`${server.root}/project/.hidden`, 'hidden')
  const session = createTestSettingsSession(server)
  const tree = createWorkbenchTree(session, 'project')
  try {
    await tree.refresh()
    expect(tree.controller.getVisibleRows(0, 10).map((row) => row.path)).toEqual(['src/'])
    await tree.open('src/')
    expect(tree.controller.getVisibleRows(0, 10).map((row) => row.path)).toEqual([
      'src/',
      'src/main.ts',
    ])
    expect(await tree.open('src/main.ts')).toBe('project/src/main.ts')
    tree.setShowHidden(true)
    expect(tree.controller.getVisibleRows(0, 10).map((row) => row.path)).toContain('.hidden')
    tree.controller.setSearch('main')
    expect(tree.controller.getVisibleRows(0, 10).map((row) => row.path)).toContain('src/main.ts')
  } finally {
    tree.dispose()
    session.dispose()
  }
})

test('tree creates and renames real files but refuses deleting nonempty folders', async ({
  server,
}) => {
  await mkdir(`${server.root}/project`)
  const session = createTestSettingsSession(server)
  const tree = createWorkbenchTree(session, 'project')
  try {
    await tree.refresh()
    expect(await tree.mutate('file', '', 'new.ts')).toBe('project/new.ts')
    expect(await readFile(`${server.root}/project/new.ts`, 'utf8')).toBe('')
    await tree.mutate('rename', 'new.ts', 'renamed.ts')
    expect(await readFile(`${server.root}/project/renamed.ts`, 'utf8')).toBe('')
    await tree.mutate('folder', '', 'src')
    await tree.mutate('file', 'src/', 'main.ts')
    await expect(tree.mutate('delete', 'src/')).rejects.toBeDefined()
    expect(await readFile(`${server.root}/project/src/main.ts`, 'utf8')).toBe('')
  } finally {
    tree.dispose()
    session.dispose()
  }
})

test('tree marks symbolic links while expanding and opening their logical paths', async ({
  server,
}) => {
  await mkdir(`${server.root}/project/src`, { recursive: true })
  await writeFile(`${server.root}/project/src/main.ts`, 'source')
  await symlink('src', `${server.root}/project/source`)
  await symlink('src/main.ts', `${server.root}/project/main-link.ts`)
  await symlink('missing', `${server.root}/project/broken`)
  const session = createTestSettingsSession(server)
  const tree = createWorkbenchTree(session, 'project')
  try {
    await tree.refresh()
    expect(tree.isSymlink('source/')).toBe(true)
    expect(tree.isSymlink('src/')).toBe(false)
    expect(tree.isSymlink('main-link.ts')).toBe(true)
    expect(tree.isSymlink('broken')).toBe(true)
    const closed = tree.controller.getVisibleRows(0, 10).find((row) => row.path === 'source/')
    if (!closed) return expect.unreachable('Expected a linked directory')
    expect(treeRowIcon(closed.kind, closed.isExpanded, tree.isSymlink(closed.path))).toBe('▸ ↗ ')
    expect(await tree.open('source/')).toBeNull()
    const expanded = tree.controller.getVisibleRows(0, 10)
    expect(expanded.map((row) => row.path)).toContain('source/main.ts')
    const alias = expanded.find((row) => row.path === 'source/')
    if (!alias) return expect.unreachable('Expected the expanded link')
    expect(treeRowIcon(alias.kind, alias.isExpanded, tree.isSymlink(alias.path))).toBe('▾ ↗ ')
    expect(tree.isSymlink('source/main.ts')).toBe(false)
    expect(await tree.open('source/main.ts')).toBe('project/source/main.ts')
    expect(await tree.open('main-link.ts')).toBe('project/main-link.ts')
    expect(treeRowIcon('file', false, tree.isSymlink('main-link.ts'))).toBe('  ↗ ')
    await rm(`${server.root}/project/main-link.ts`)
    await writeFile(`${server.root}/project/main-link.ts`, 'regular file')
    await tree.refresh()
    expect(tree.isSymlink('main-link.ts')).toBe(false)
    expect(treeRowIcon('file', false, tree.isSymlink('main-link.ts'))).toBe('  ')
  } finally {
    tree.dispose()
    session.dispose()
    await session.flush()
  }
})
