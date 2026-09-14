import { getClient } from '@/lib/client'
import { documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { tabLabel } from '@/lib/documents/utils/labels'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core'
import type { ReactElement, ReactNode } from 'react'
import { toast } from 'sonner'
import { vi } from 'vitest'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { notifyChangedFilesystemConflict } from '@/features/workspace/state/event-conflict-adapter'
import { createFileContent, ensureFolderPath, fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'

import { expect, test } from '../../../../test/fixtures'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { AppProviders, createTestQueryClient } from '../../../../test/render'

// The toast is the only door into the conflict editor, so this drives it the way a user does:
// dirty buffer, file changed underneath, Compare. What must come out is a tab of its own that
// names the file and can pick its language from it.
test('Compare on the conflict toast opens the conflict editor in its own tab', async ({
  client,
}) => {
  void client
  const path = filesystemPath('repo/src/a.ts')
  await ensureFolderPath(filesystemPath('repo/src'), getClient())
  await createFileContent(path, 'const a = 1\n', getClient())
  const file = await fetchFile(path, new AbortController().signal, getClient())
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>{children}</TestEditorStateProvider>
      </AppProviders>
    )
  }
  const hook = renderHook(() => ({ commands: useEditorCommands(), runtime: useEditorRuntime() }), {
    wrapper: Wrapper,
  })
  const { conflictStore, documentStore, workspaceStore } = hook.result.current.runtime
  setFileSnapshotQueryData(queryClient, file)
  await act(async () => {
    await hook.result.current.commands.openFileSurface(path)
  })
  const fileTabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
  const view = documentStore.getState().ensureEditorView(fileTabId, file)
  act(() => createEditorBufferSession(view.buffer, view.view).applyText('const b = 2\n'))

  const custom = vi.spyOn(toast, 'custom').mockImplementation(() => 'conflict-toast')
  try {
    const { commands } = hook.result.current
    const documentState = documentStore.getState()
    act(() =>
      notifyChangedFilesystemConflict(
        path,
        { ...file, content: 'const a = 3\n', version: 'remote-2' },
        {
          client: getClient(),
          conflictStore,
          discardLiveEditorDocument: commands.discardLiveEditorDocument,
          ensureUnsyncedEditorDocument: documentState.ensureUnsyncedEditorDocument,
          fetchFile: (target, signal) => fetchFile(target, signal, getClient()),
          forceReplaceLiveEditorDocument: documentState.forceReplaceLiveEditorDocument,
          getLiveEditorDocument: documentState.getLiveEditorDocument,
          queryClient,
          renameLiveEditorDocument: commands.renameLiveEditorDocument,
          selectContent: commands.selectContent,
        },
      ),
    )
    const renderToast = custom.mock.calls[0]![0] as () => ReactElement
    render(renderToast())
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    })
  } finally {
    custom.mockRestore()
  }

  const panels = workspaceStore.getState().workbenchPanels
  const conflictTab = panels.editorTabs.find(
    (tab) => tab.content.kind === 'document' && tab.content.document.kind === 'conflict',
  )
  expect(conflictTab).toBeDefined()
  expect(panels.activeEditorTabId).toBe(conflictTab!.id)
  expect(panels.editorTabs.map((tab) => tab.id)).toEqual([fileTabId, conflictTab!.id])
  const document = conflictTab!.content.kind === 'document' ? conflictTab!.content.document : null
  expect(documentSourcePath(document!)).toBe(path)
  expect(languageIdForFilePath(documentSourcePath(document!)!)).toBe('typescript')
  expect(tabLabel(conflictTab!.content)).toBe('a.ts')
  const conflictDocument = documentStore.getState().getLiveEditorDocument(documentKey(document!))
  expect(conflictDocument?.buffer.materializeFullText()).toBe(
    [
      '<<<<<<< Local: repo/src/a.ts',
      'const a = 1',
      'const b = 2',
      '=======',
      'const a = 3',
      '>>>>>>> Remote: repo/src/a.ts',
      '',
    ].join('\n'),
  )
})
