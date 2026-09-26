import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { waitFor } from '@testing-library/react'
import { useProjectMenuEntries } from '@/features/workbench/hooks/use-project-menu-entries'
import { ensureFolderPath } from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { renderHookWithProviders } from '../../../../test/render'

test('merges chat-only aliases with recent folders using their canonical roots', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('projects/platform'), getClient())
  await ensureFolderPath(filesystemPath('projects/another'), getClient())
  await symlink('projects', path.join(server.root, 'Projects'))

  const { result } = renderHookWithProviders(() =>
    useProjectMenuEntries({
      enabled: true,
      activeRootPath: 'projects/platform',
      activeTitle: 'platform',
      recentFolders: [{ name: 'another', path: 'projects/another' }],
      projects: [
        {
          title: 'platform',
          updatedAt: '2026-09-08T00:00:00Z',
          workspaceRoot: 'Projects/platform',
        },
        { title: 'another', updatedAt: '2026-09-07T00:00:00Z', workspaceRoot: 'Projects/another' },
      ],
    }),
  )

  await waitFor(() => expect(result.current.isPending).toBe(false))
  expect(result.current.entries).toEqual([
    { title: 'platform', rootPath: 'projects/platform', qualifier: null },
    { title: 'another', rootPath: 'projects/another', qualifier: null },
  ])
})

test('drops roots that no longer exist and lands the rest together', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('projects/platform'), getClient())
  await ensureFolderPath(filesystemPath('projects/another'), getClient())
  const seen: number[] = []

  const { result } = renderHookWithProviders(() => {
    const menu = useProjectMenuEntries({
      enabled: true,
      activeRootPath: 'projects/platform',
      activeTitle: 'platform',
      recentFolders: [{ name: 'another', path: 'projects/another' }],
      projects: [
        { title: 'removed', updatedAt: '2026-09-08T00:00:00Z', workspaceRoot: 'worktrees/removed' },
      ],
    })
    seen.push(menu.entries.length)
    return menu
  })

  await waitFor(() => expect(result.current.isPending).toBe(false))
  expect(result.current.entries.map((entry) => entry.rootPath)).toEqual([
    'projects/platform',
    'projects/another',
  ])
  expect(new Set(seen)).toEqual(new Set([1, 2]))
})

test('nests a linked worktree under its repository with its branch', async ({ client, server }) => {
  void client
  await ensureFolderPath(filesystemPath('projects/platform'), getClient())
  const repo = path.join(server.root, 'projects/platform')
  const git = (...args: string[]) =>
    Bun.spawn(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo }).exited
  await git('init', '-b', 'main')
  await git('commit', '--allow-empty', '-m', 'init')
  await git('worktree', 'add', path.join(server.root, 'worktrees/t07'), '-b', 'task/t07')

  const { result } = renderHookWithProviders(() =>
    useProjectMenuEntries({
      enabled: true,
      activeRootPath: 'worktrees/t07',
      activeTitle: 't07',
      recentFolders: [],
      projects: [],
    }),
  )

  await waitFor(() => expect(result.current.isPending).toBe(false))
  expect(result.current.entries).toEqual([
    { title: 'platform', rootPath: 'projects/platform', qualifier: null },
    { title: 't07', rootPath: 'worktrees/t07', qualifier: null, worktree: { branch: 'task/t07' } },
  ])
})

test('resolves every candidate in one request', async ({ client, server }) => {
  void client
  const names = ['one', 'two', 'three', 'four']
  for (const name of names) await ensureFolderPath(filesystemPath(`projects/${name}`), getClient())
  const lookups: string[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    const pathname = new URL(request.url).pathname
    if (pathname.startsWith('/fs/workspace-address')) lookups.push(pathname)
  })
  const restore = installTestClient(observed)
  try {
    const { result } = renderHookWithProviders(() =>
      useProjectMenuEntries({
        enabled: true,
        activeRootPath: 'projects/one',
        activeTitle: 'one',
        recentFolders: names.map((name) => ({ name, path: `projects/${name}` })),
        projects: [
          { title: 'gone', updatedAt: '2026-09-08T00:00:00Z', workspaceRoot: 'worktrees/gone' },
        ],
      }),
    )

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.entries.map((entry) => entry.rootPath)).toEqual(
      names.map((name) => `projects/${name}`),
    )
    expect(lookups).toEqual(['/fs/workspace-addresses'])
  } finally {
    restore()
  }
})
