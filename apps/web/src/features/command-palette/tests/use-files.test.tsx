import { filesystemPath } from '@/lib/documents/utils/identity'
import { waitFor } from '@testing-library/react'
import { renderHookWithProviders } from '../../../../test/render'

import { expect, test } from '../../../../test/fixtures'
import type { FilePaletteItem } from '@/features/command-palette/utils/types'
import { useFiles } from '@/features/command-palette/hooks/use-files'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'

test('keeps the previous quick-open rows up until the new query answers', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'repo', recursive: true })
  await client.fs['create-file'].post({ path: 'repo/rendering.ts' })
  await client.fs['create-file'].post({ path: 'repo/default-bindings.ts' })

  const { result, rerender, queryClient } = renderHookWithProviders(
    ({ query }: { query: string }) =>
      useFiles({
        mode: 'files',
        open: true,
        query,
        rootPath: filesystemPath('repo'),
        treeState: emptyTreeState(),
      }),
    {
      initialProps: { query: 'rendering' },
    },
  )

  await waitFor(() =>
    expect(filePaths(result.current.visibleFileItems)).toEqual(['repo/rendering.ts']),
  )

  rerender({ query: 'binding' })

  expect(filePaths(result.current.visibleFileItems)).toEqual(['repo/rendering.ts'])
  expect(result.current.fileSearchUnsettled).toBe(true)

  await waitFor(() =>
    expect(filePaths(result.current.visibleFileItems)).toEqual(['repo/default-bindings.ts']),
  )
  expect(result.current.fileSearchUnsettled).toBe(false)
  queryClient.clear()
})

function emptyTreeState(): LoadState<TreeModel> {
  return {
    data: {
      entriesByTreePath: new Map(),
      errorByDirectoryPath: new Map(),
      loadedDirectoryPaths: new Set(),
      loadingDirectoryPaths: new Set(),
      paths: [],
    },
    status: 'ready',
  }
}

function filePaths(items: readonly FilePaletteItem[]) {
  return items.map((item) => item.entry.path)
}
