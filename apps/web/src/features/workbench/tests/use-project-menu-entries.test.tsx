import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { waitFor } from '@testing-library/react'
import { useProjectMenuEntries } from '@/features/workbench/hooks/use-project-menu-entries'
import { ensureFolderPath } from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'
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
