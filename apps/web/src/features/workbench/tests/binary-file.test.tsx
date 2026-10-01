import { truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { fileDocument, fileResource, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'

for (const size of [5, 200 * 1024 * 1024 + 1]) {
  test(`binary file of ${size} bytes paints facts without registering a buffer, view or dirty state`, async ({
    server,
    client,
  }) => {
    const path = filesystemPath('binary.txt')
    await writeFile(join(server.root, path), Buffer.from([0, 1, 255, 0, 7]))
    await truncate(join(server.root, path), size)
    const { application, editor } = await createAddressTestRuntime(client)
    const queryClient = application.getSnapshot().queryClient
    const rendered = renderWithProviders(
      <TestEditorStateProvider>
        <EditorSurfaceTabBody
          active
          content={documentTab(fileDocument(fileResource(path)))}
          rootPath={filesystemPath('')}
          tabId={tabId('binary')}
        />
      </TestEditorStateProvider>,
      { application, queryClient },
    )
    await waitFor(() => expect(rendered.getByRole('region', { name: 'File facts' })).toBeVisible())
    expect(rendered.getByText(size === 5 ? '5 B' : '200 MB')).toBeVisible()
    expect(rendered.getByText('TXT file')).toBeVisible()
    expect(rendered.queryByRole('textbox', { name: 'Editor input' })).toBeNull()
    expect(editor.documentStore.getState().liveDocumentsByKey).toEqual({})
    expect(editor.documentStore.getState().viewsByTabId).toEqual({})
    expect(editor.documentStore.getState().dirtyDocumentKeys.size).toBe(0)
  })
}

test('oversized encoded text keeps the editing-limit body without creating a text buffer', async ({
  server,
  client,
}) => {
  const path = filesystemPath('large.txt')
  await writeFile(join(server.root, path), Buffer.from([0xff, 0xfe, 0x61, 0]))
  await truncate(join(server.root, path), 200 * 1024 * 1024 + 2)
  const { application, editor } = await createAddressTestRuntime(client)
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <EditorSurfaceTabBody
        active
        content={documentTab(fileDocument(fileResource(path)))}
        rootPath={filesystemPath('')}
        tabId={tabId('large-text')}
      />
    </TestEditorStateProvider>,
    { application, queryClient: application.getSnapshot().queryClient },
  )
  await waitFor(() =>
    expect(rendered.getByRole('button', { name: 'Open read-only' })).toBeVisible(),
  )
  expect(rendered.queryByRole('region', { name: 'File facts' })).toBeNull()
  expect(editor.documentStore.getState().liveDocumentsByKey).toEqual({})
  expect(editor.documentStore.getState().dirtyDocumentKeys.size).toBe(0)
})
