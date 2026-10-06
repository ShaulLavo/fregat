import { act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { useEditorInputPending } from '@/features/workbench/hooks/use-editor-input-pending'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fileDocument, fileResource, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import type { TabContent, TabId } from '@/lib/documents/utils/types'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fileSystemKeys } from '@/lib/query-keys'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

test('keeps a resolved file pending until its selected view binds', () => {
  const queryClient = createTestQueryClient()
  const file = {
    path: filesystemPath('/repo/a.ts'),
    content: 'export const a = 1\n',
    mtimeMs: 1,
    size: 19,
    version: 'v1',
  }
  setFileSnapshotQueryData(queryClient, file)
  const id = tabId('loading-file')
  let store: ReturnType<typeof useEditorDocumentStoreApi> | undefined
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <PendingProbe
        content={documentTab(fileDocument(fileResource(file.path)))}
        id={id}
        onStore={(current) => {
          store = current
        }}
      />
    </TestEditorStateProvider>,
    { queryClient },
  )
  expect(rendered.getByTestId('pending').textContent).toBe('true')
  expect(store).toBeDefined()
  act(() => store?.getState().ensureEditorView(tabId('other-tab'), file))
  expect(rendered.getByTestId('pending').textContent).toBe('true')
  act(() => store?.getState().ensureEditorView(id, { ...file, path: filesystemPath('/repo/b.ts') }))
  expect(rendered.getByTestId('pending').textContent).toBe('true')
  act(() => store?.getState().ensureEditorView(id, file))
  expect(rendered.getByTestId('pending').textContent).toBe('false')
})

test('marks a cold file pending without starting a read', () => {
  const queryClient = createTestQueryClient()
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <PendingProbe
        content={documentTab(fileDocument(fileResource(filesystemPath('/repo/cold.ts'))))}
        id={tabId('cold')}
      />
    </TestEditorStateProvider>,
    { queryClient },
  )
  expect(rendered.getByTestId('pending').textContent).toBe('true')
  expect(
    queryClient.isFetching({
      exact: true,
      queryKey: fileSystemKeys.fileSnapshot(filesystemPath('/repo/cold.ts')),
    }),
  ).toBe(0)
})

test.each([
  { kind: 'settings' },
  documentTab(fileDocument(fileResource(filesystemPath('/repo/manual.pdf')))),
] satisfies TabContent[])('does not await a text view for %j', (content) => {
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <PendingProbe content={content} id={tabId('other-content')} />
    </TestEditorStateProvider>,
  )
  expect(rendered.getByTestId('pending').textContent).toBe('false')
})

test('binary file facts do not await a text view', () => {
  const queryClient = createTestQueryClient()
  const path = filesystemPath('/repo/binary.bin')
  setFileSnapshotQueryData(queryClient, {
    path,
    content: '\0',
    seemsBinary: true,
    mtimeMs: 1,
    size: 1,
    version: 'v1',
  })
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <PendingProbe content={documentTab(fileDocument(fileResource(path)))} id={tabId('binary')} />
    </TestEditorStateProvider>,
    { queryClient },
  )
  expect(rendered.getByTestId('pending').textContent).toBe('false')
})

test('a failed file read ends loading without a text view', async ({ client, server }) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  const path = filesystemPath(`${server.root}/missing.ts`)
  await expect(queryClient.query(fileSnapshotQueryOptions(path))).rejects.toBeDefined()
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <PendingProbe content={documentTab(fileDocument(fileResource(path)))} id={tabId('failed')} />
    </TestEditorStateProvider>,
    { queryClient },
  )
  expect(rendered.getByTestId('pending').textContent).toBe('false')
})

function PendingProbe({
  content,
  id,
  onStore,
}: {
  readonly content: TabContent
  readonly id: TabId
  readonly onStore?: (store: ReturnType<typeof useEditorDocumentStoreApi>) => void
}) {
  const pending = useEditorInputPending(content, id)
  const store = useEditorDocumentStoreApi()
  useLayoutEffect(() => onStore?.(store), [onStore, store])
  return <output data-testid='pending'>{String(pending)}</output>
}
