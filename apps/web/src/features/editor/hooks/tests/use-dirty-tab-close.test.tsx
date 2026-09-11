import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { isValidElement, type ReactNode } from 'react'

import { UnsavedChangesDialog } from '@/features/editor/components/unsaved-changes-dialog'
import {
  type CloseRequestResult,
  type UnsavedDialogTarget,
  useDirtyTabCloseRequest,
} from '@/features/editor/hooks/use-dirty-tab-close'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { WorkspaceEditServiceContext } from '@/features/editor/providers/workspace-edit-context'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  activeEditorTabForWorkbenchPanels,
  editorTabRecordsForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type { FileResult } from '@/lib/file-system-types'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { settingsJsonDocumentId } from '@/features/settings/utils/json-document'
import { expect, test } from '../../../../../test/fixtures'
import { AppProviders, createTestQueryClient } from '../../../../../test/render'

test('a clean close returns the exact open tab ids it closed', async () => {
  const hook = renderDirtyTabClose()
  const firstTabId = openFile(hook.result.current, '/repo/src/first.ts')
  const secondTabId = openFile(hook.result.current, '/repo/src/second.ts')
  expect(firstTabId).not.toBeNull()
  expect(secondTabId).not.toBeNull()
  if (!firstTabId || !secondTabId) return

  let closeResult: CloseRequestResult | undefined
  act(() => {
    closeResult = hook.result.current.requestCloseTabs([
      secondTabId,
      'missing-tab',
      firstTabId,
      secondTabId,
    ])
  })

  expect(closeResult).toMatchObject({ status: 'closed', tabIds: [secondTabId, firstTabId] })
  if (closeResult?.status !== 'closed') return expect.unreachable('clean close did not start')
  const completion = closeResult.completion
  await act(async () => {
    expect(await completion).toEqual({ status: 'applied' })
  })
  expect(openTabs(hook.result.current)).toEqual([])
})

test('a dirty close defers with one stable opaque dialog target and rejects another request', () => {
  const hook = renderDirtyTabClose()
  const tabId = openFile(hook.result.current, '/repo/src/dirty.ts', true)
  expect(tabId).not.toBeNull()
  if (!tabId) return

  let firstRequest: CloseRequestResult | undefined
  let secondRequest: CloseRequestResult | undefined
  act(() => {
    firstRequest = hook.result.current.requestCloseTab(tabId)
    secondRequest = hook.result.current.requestCloseTab(tabId)
  })
  if (!firstRequest) return
  expect(firstRequest.status).toBe('deferred')
  if (firstRequest.status !== 'deferred') return

  const target = firstRequest.dialogTarget
  expect(firstRequest.tabIds).toEqual([tabId])
  expect(Reflect.ownKeys(target)).toEqual([])
  expect(dialogTarget(hook.result.current.dirtyTabCloseDialog)).toBe(target)

  expect(secondRequest).toEqual({ status: 'rejected', reason: 'busy' })
  expect(dialogTarget(hook.result.current.dirtyTabCloseDialog)).toBe(target)
})

test('a dirty close disables Save while the workspace mutation gate is closed', () => {
  const workspaceEdits = {
    canMutateWorkspace: () => false,
    subscribe: () => () => undefined,
  } as unknown as WorkspaceEditService
  const hook = renderDirtyTabClose(workspaceEdits)
  const tabId = openFile(hook.result.current, '/repo/src/dirty.ts', true)
  expect(tabId).not.toBeNull()
  if (!tabId) return

  act(() => {
    hook.result.current.requestCloseTab(tabId)
  })

  expect(dialogCanSave(hook.result.current.dirtyTabCloseDialog)).toBe(false)
})

test('a dirty settings tab offers Save for its writable JSON buffer', async () => {
  const hook = renderDirtyTabClose()
  const tabId = await openDirtySettings(hook.result.current)
  expect(tabId).not.toBeNull()
  if (!tabId) return

  act(() => {
    hook.result.current.requestCloseTab(tabId)
  })

  expect(dialogCanSave(hook.result.current.dirtyTabCloseDialog)).toBe(true)
})

test('a missing tab is rejected as not found', () => {
  const hook = renderDirtyTabClose()
  let closeResult: CloseRequestResult | undefined

  act(() => {
    closeResult = hook.result.current.requestCloseTab('missing-tab')
  })

  expect(closeResult).toEqual({
    status: 'rejected',
    reason: 'not-found',
  })
})

test('cancelling a dirty close restores the still-open editor target', async () => {
  renderDirtyFocusHarness()
  prepareDirtyClose()
  const dirtySurface = await screen.findByRole('button', { name: 'Active /repo/src/dirty.ts' })
  dirtySurface.focus()

  fireEvent.click(screen.getByRole('button', { name: 'Request dirty close' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(activeHtmlElement()))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(dirtySurface))
})

test('discarding a dirty close focuses the successor editor target', async () => {
  renderDirtyFocusHarness()
  prepareDirtyClose()
  const dirtySurface = await screen.findByRole('button', { name: 'Active /repo/src/dirty.ts' })
  dirtySurface.focus()

  fireEvent.click(screen.getByRole('button', { name: 'Request dirty close' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(activeHtmlElement()))
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

  const successor = await screen.findByRole('button', { name: 'Active /repo/src/next.ts' })
  await waitFor(() => expect(document.activeElement).toBe(successor))
})

function renderDirtyTabClose(workspaceEdits: WorkspaceEditService | null = null) {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <EditorStateProvider>
          <WorkspaceEditServiceContext value={workspaceEdits}>
            {children}
          </WorkspaceEditServiceContext>
        </EditorStateProvider>
      </AppProviders>
    )
  }

  return renderHook(useDirtyTabCloseHarness, { wrapper: Wrapper })
}

function renderDirtyFocusHarness() {
  const queryClient = createTestQueryClient()
  return render(
    <AppProviders queryClient={queryClient}>
      <EditorStateProvider>
        <DirtyFocusHarness />
      </EditorStateProvider>
    </AppProviders>,
  )
}

function prepareDirtyClose() {
  fireEvent.click(screen.getByRole('button', { name: 'Prepare dirty close' }))
}

function activeHtmlElement() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function DirtyFocusHarness() {
  const close = useDirtyTabCloseRequest()
  const commands = useEditorCommands()
  const documentStore = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceState((state) => state.workbenchPanels)
  const activeTab = activeEditorTabForWorkbenchPanels(workspace)
  const { ref: activeTargetRef } = useFocusTarget<HTMLButtonElement>({
    area: 'editor',
    capabilities: { editor: { dispatch: () => false, writable: true } },
    id: {
      key: activeTab?.path ?? '',
      kind: 'editor',
      surface: 'document',
      tabId: activeTab?.id,
    },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      element.focus()
      return true
    },
  })

  function prepare() {
    commands.openFileSurface('/repo/src/next.ts')
    documentStore.getState().ensureLiveEditorDocument(fileResult('/repo/src/next.ts'))
    commands.openFileSurface('/repo/src/dirty.ts')
    documentStore.getState().ensureLiveEditorDocument(fileResult('/repo/src/dirty.ts'))
    documentStore.getState().setLiveEditorDocumentDirty('/repo/src/dirty.ts', true)
  }

  function requestClose() {
    if (!activeTab) return

    close.requestCloseTab(activeTab.id)
  }

  return (
    <div data-workbench=''>
      <button type='button' onClick={prepare}>
        Prepare dirty close
      </button>
      <button type='button' onClick={requestClose}>
        Request dirty close
      </button>
      {activeTab ? (
        <button ref={activeTargetRef} type='button'>
          Active {activeTab.path}
        </button>
      ) : null}
      {close.dirtyTabCloseDialog}
    </div>
  )
}

function useDirtyTabCloseHarness() {
  return {
    ...useDirtyTabCloseRequest(),
    commands: useEditorCommands(),
    documentStore: useEditorDocumentStoreApi(),
    workspaceStore: useEditorWorkspaceStoreApi(),
  }
}

type DirtyTabCloseHarness = ReturnType<typeof useDirtyTabCloseHarness>

function openFile(harness: DirtyTabCloseHarness, path: string, dirty = false) {
  act(() => {
    harness.commands.openFileSurface(path)
    harness.documentStore.getState().ensureLiveEditorDocument(fileResult(path))
    harness.documentStore.getState().setLiveEditorDocumentDirty(path, dirty)
  })

  return openTabs(harness).find((tab) => tab.path === path)?.id ?? null
}

async function openDirtySettings(harness: DirtyTabCloseHarness) {
  const documentId = settingsJsonDocumentId('user')
  await act(async () => {
    await harness.commands.openSettingsEditor()
    harness.documentStore.getState().ensureUnsyncedEditorDocument({
      content: '{}\n',
      id: documentId,
      sync: { kind: 'settings', revision: 'rev-1', state: 'idle', target: 'user' },
    })
    harness.documentStore.getState().setLiveEditorDocumentDirty(documentId, true)
  })

  return openTabs(harness).find((tab) => tab.path === settingsDocumentId())?.id ?? null
}

function openTabs(harness: DirtyTabCloseHarness) {
  return editorTabRecordsForWorkbenchPanels(harness.workspaceStore.getState().workbenchPanels)
}

function dialogTarget(dialog: ReactNode): UnsavedDialogTarget | null {
  if (!isValidElement<{ target?: UnsavedDialogTarget | null }>(dialog)) return null
  if (dialog.type !== UnsavedChangesDialog) return null

  return dialog.props.target ?? null
}

function dialogCanSave(dialog: ReactNode): boolean | null {
  if (!isValidElement<{ canSave?: boolean }>(dialog)) return null
  if (dialog.type !== UnsavedChangesDialog) return null

  return dialog.props.canSave ?? null
}

function fileResult(path: string): FileResult {
  return {
    content: `contents of ${path}`,
    mtimeMs: 100,
    path,
    size: 20,
    version: `test:${path}`,
  }
}
