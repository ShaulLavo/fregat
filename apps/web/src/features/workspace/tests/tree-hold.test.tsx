import { act, screen, waitFor } from '@testing-library/react'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useWorkspaceTreeForRootPath } from '@/features/workspace/hooks/use-tree'
import { captureTree, savedTree } from '@/features/workspace/state/tree-reload'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSystemKeys } from '@/lib/query-keys'
import type { TreeModel } from '@/lib/tree-model'
import { createObservedInProcessClient } from '../../../../test/client'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test.for(['missing', 'not-directory', 'permission-denied'] as const)(
  'a delayed %s root response settles held rows and saved observations',
  async (failure, { server }) => {
    for (const root of ['first', 'second']) {
      await mkdir(path.join(server.root, root))
      await writeFile(path.join(server.root, root, `${root}.txt`), 'file\n')
    }
    let delay = false
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const observed = createObservedInProcessClient(server, async (request) => {
      const url = new URL(request.url)
      if (!delay || url.pathname !== '/fs/tree' || url.searchParams.get('path') !== 'first') return
      started.resolve()
      await release.promise
    })
    const { application } = await createAddressTestRuntime(observed)
    const queryClient = application.getSnapshot().queryClient
    queryClient.setDefaultOptions({ queries: { retry: false } })
    const view = (root: string) => (
      <TestEditorStateProvider>
        <TreeQueryProbe root={root} />
      </TestEditorStateProvider>
    )
    const rendered = renderWithProviders(view('first'), { application, queryClient })
    try {
      for (const root of ['first', 'second']) {
        rendered.rerender(view(root))
        await screen.findByText(`${root}.txt`)
        const model = queryClient.getQueryData<TreeModel>(fileSystemKeys.tree(root))!
        captureTree(queryClient, model, {
          root: filesystemPath(root),
          worktree: null,
          activeFile: null,
          expanded: [],
          selected: [],
          scrollTop: 42,
        })
      }
      const held = savedTree(queryClient, 'first', null)!
      delay = true
      act(() => queryClient.removeQueries({ queryKey: fileSystemKeys.tree('first') }))
      rendered.rerender(view('first'))
      await started.promise
      expect(screen.getByText('first.txt')).toBeVisible()
      if (failure === 'permission-denied') await chmod(path.join(server.root, 'first'), 0)
      else await rm(path.join(server.root, 'first'), { recursive: true })
      if (failure === 'not-directory') await writeFile(path.join(server.root, 'first'), 'file')
      release.resolve()
      await waitFor(() =>
        expect(queryClient.getQueryState(fileSystemKeys.tree('first'))?.status).toBe('error'),
      )
      if (failure === 'permission-denied') {
        await waitFor(() =>
          expect(screen.getByRole('status')).toHaveTextContent('ready:refresh-error'),
        )
        expect(screen.getByText('first.txt')).toBeVisible()
        expect(savedTree(queryClient, 'first', null)).not.toBeNull()
        return
      }
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^error$/))
      expect(screen.queryByText('first.txt')).toBeNull()
      expect(savedTree(queryClient, 'first', null)).toBeNull()
      act(() => queryClient.removeQueries({ queryKey: fileSystemKeys.tree('first') }))
      captureTree(queryClient, held.model, held.record)
      expect(savedTree(queryClient, 'first', null)).toBeNull()
      expect(savedTree(queryClient, 'second', null)?.record.scrollTop).toBe(42)
    } finally {
      release.resolve()
      if (failure === 'permission-denied') await chmod(path.join(server.root, 'first'), 0o755)
      rendered.unmount()
    }
  },
)

function TreeQueryProbe({ root }: { readonly root: string }) {
  const { treeState } = useWorkspaceTreeForRootPath(root)
  return (
    <div>
      <span role='status'>
        {treeState.status}
        {treeState.refreshError ? ':refresh-error' : ''}
      </span>
      {treeState.status === 'ready'
        ? treeState.data.paths.map((path) => <span key={path}>{path}</span>)
        : null}
    </div>
  )
}
