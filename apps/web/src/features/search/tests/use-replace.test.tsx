import { statPath } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { makeTestServer } from '../../../../test/server'
import { act } from '@testing-library/react'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Button } from '@workspace/ui/components/button'

import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { createObservedInProcessClient } from '../../../../test/client'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { installTestClient } from '../../../../test/factories/client-binding'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { textChangePreview } from '../../../../test/factories/workspace-text-changes'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('keeps replacement reads on the original machine when the selection changes', async ({
  server,
  client,
}) => {
  void client
  const otherServer = await makeTestServer()
  const originalOrigin = activeServerOrigin()
  const otherOrigin = 'http://replacement-other.test'
  setActiveServerOrigin(otherOrigin)
  const previousOtherClient = getClient()
  const otherReads: string[] = []
  setClient(
    createObservedInProcessClient(otherServer, (request) => {
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
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const paths = ['first.ts', 'second.ts']
  await Promise.all(paths.map((path) => writeFile(join(server.root, path), 'needle')))
  await Promise.all(paths.map((path) => writeFile(join(otherServer.root, path), 'other needle')))
  const application = createTestApplicationRuntime()
  const { editor } = application.getSnapshot()
  const replacement = Promise.withResolvers<void>()
  const stopObservingReplacement = editor.searchBufferStore.subscribe(
    (state) => state.active?.replaceStatus,
    (status, previous) => {
      if (previous === 'running' && status !== 'running') replacement.resolve()
    },
  )

  const view = renderWithProviders(
    <TestEditorStateProvider>
      <ReplaceControl rootPath='' />
    </TestEditorStateProvider>,
    { application },
  )
  try {
    const button = await view.findByRole('button', { name: 'Replace all' })
    act(() => {
      editor.workspaceStore.getState().switchWorkspace({ ...root, name: 'Root', type: 'directory' })
      const search = editor.searchBufferStore.getState()
      search.prepareBuffer('')
      search.setReplaceText('', 'pin')
      const runId = search.startSearch({
        path: '',
        query: 'needle',
        includeContent: true,
        limit: 20,
      })
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
    })
    expect(button).toBeEnabled()
    act(() => button.click())
    const operationId = await textChangePreview(editor.workspaceEditService)
    expect(editor.workspaceEditService.getSnapshot().phase).toBe('awaiting-confirmation')
    await act(async () => {
      editor.workspaceEditService.confirmPreview(operationId)
      await replacement.promise
    })
    expect(editor.searchBufferStore.getState().active?.replaceStatus).toBe('success')
    expect([...new Set(originalReads)]).toEqual(paths)
    expect(
      await Promise.all(paths.map((path) => readFile(join(server.root, path), 'utf8'))),
    ).toEqual(['pin', 'pin'])
    expect(
      await Promise.all(paths.map((path) => readFile(join(otherServer.root, path), 'utf8'))),
    ).toEqual(['other needle', 'other needle'])
    expect(otherReads).toEqual([])
  } finally {
    stopObservingReplacement()
    view.unmount()
    setActiveServerOrigin(otherOrigin)
    setClient(previousOtherClient)
    setActiveServerOrigin(originalOrigin)
    restore()
    await otherServer.cleanup()
  }
})

// A run that fails mid-stream keeps the matches it delivered, so `'error'` must
// not be replaceable.
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
