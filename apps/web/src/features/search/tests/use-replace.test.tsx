import { act, waitFor } from '@testing-library/react'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Button } from '@workspace/ui/components/button'

import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { createObservedInProcessClient } from '../../../../test/client'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { installTestClient } from '../../../../test/factories/client-binding'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('keeps replacement reads on the original machine when the selection changes', async ({
  server,
  client,
}) => {
  void client
  const originalOrigin = activeServerOrigin()
  const otherOrigin = 'http://replacement-other.test'
  setActiveServerOrigin(otherOrigin)
  const previousOtherClient = getClient()
  const otherReads: string[] = []
  setClient(
    createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname === '/fs/read') otherReads.push(request.url)
    }),
  )
  setActiveServerOrigin(originalOrigin)

  const originalReads: string[] = []
  const restore = installTestClient(
    createObservedInProcessClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/read') return
      originalReads.push(url.searchParams.get('path') ?? '')
      setActiveServerOrigin(otherOrigin)
    }),
  )
  const paths = ['first.ts', 'second.ts']
  await Promise.all(paths.map((path) => writeFile(join(server.root, path), 'needle')))
  const application = createTestApplicationRuntime()
  const { editor } = application.getSnapshot()
  const search = editor.searchBufferStore.getState()
  search.prepareBuffer('')
  search.setReplaceText('', 'pin')
  const runId = search.startSearch({ path: '', query: 'needle', includeContent: true, limit: 20 })
  for (const path of paths) {
    search.appendEvent(runId, {
      type: 'match',
      match: {
        path,
        kind: 'content',
        type: 'file',
        source: 'disk',
        line: 1,
        column: 1,
        endColumn: 7,
      },
    })
  }
  search.appendEvent(runId, {
    type: 'done',
    path: '',
    query: 'needle',
    count: 2,
    truncated: false,
  })

  const view = renderWithProviders(
    <TestEditorStateProvider>
      <ReplaceControl rootPath='' />
    </TestEditorStateProvider>,
    { application },
  )
  try {
    const button = await view.findByRole('button', { name: 'Replace all' })
    expect(button).toBeEnabled()
    act(() => button.click())
    await waitFor(() =>
      expect(editor.searchBufferStore.getState().active?.replaceStatus).not.toBe('running'),
    )
    expect(originalReads).toEqual(paths)
    expect(otherReads).toEqual([])
  } finally {
    view.unmount()
    setActiveServerOrigin(otherOrigin)
    setClient(previousOtherClient)
    setActiveServerOrigin(originalOrigin)
    restore()
  }
})

// A run that fails mid-stream keeps the matches it already delivered. The gate
// used to block only `'loading'`, so `'error'` passed and replace stayed enabled
// over a set the app itself knows is incomplete.
test('refuses to replace over the partial matches of a failed search', async ({ client }) => {
  void client
  const application = createTestApplicationRuntime()
  const { editor } = application.getSnapshot()
  const search = editor.searchBufferStore.getState()
  search.prepareBuffer('')
  search.setReplaceText('', 'pin')
  const runId = search.startSearch({ path: '', query: 'needle', includeContent: true, limit: 20 })
  search.appendEvent(runId, {
    type: 'match',
    match: {
      path: 'first.ts',
      kind: 'content',
      type: 'file',
      source: 'disk',
      line: 1,
      column: 1,
      endColumn: 7,
    },
  })
  search.failSearch(runId, 'Search stream ended without completing.')

  expect(editor.searchBufferStore.getState().active?.status).toBe('error')

  const view = renderWithProviders(
    <TestEditorStateProvider>
      <ReplaceControl rootPath='' />
    </TestEditorStateProvider>,
    { application },
  )
  try {
    expect(await view.findByRole('button', { name: 'Replace all' })).toBeDisabled()
  } finally {
    view.unmount()
  }
})

function ReplaceControl({ rootPath }: { readonly rootPath: string }) {
  const { canReplace, replaceAll } = useWorkspaceSearchReplace(rootPath)
  return (
    <Button disabled={!canReplace} onClick={replaceAll}>
      Replace all
    </Button>
  )
}
