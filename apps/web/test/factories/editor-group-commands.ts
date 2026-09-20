import type { QueryClient } from '@tanstack/react-query'
import type { EditorCommands } from '@/features/editor/state/commands'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  placementMutationOptions,
  resizeMutationOptions,
} from '@/features/editor/state/group-mutations'
import { createGroupId, createSplitId, type EditorGroups } from '@/lib/documents/utils/group-types'
import {
  placeTabInGroups,
  resizeEditorGroups,
  selectEditorGroup,
} from '@/lib/documents/utils/groups'
import { createTabId } from '@/lib/documents/utils/identity'
import { runMutation } from '@/lib/mutations/run'

export function createTestGroupCommands(
  queryClient: QueryClient,
  workspace: EditorWorkspaceStoreApi,
  documents: EditorDocumentStoreApi,
  ui: EditorUiStoreApi,
): Pick<EditorCommands, 'placeTab' | 'resizeEditorSplit' | 'setActiveGroup' | 'requestMoveTab'> {
  const scope = `test-editor-groups:${createGroupId()}`
  const publish = (groups: EditorGroups) => {
    const panels = workspace.getState().workbenchPanels
    workspace.getState().setWorkbenchPanels({ ...panels, editorGroups: groups })
  }

  return {
    placeTab: (placement) =>
      runMutation(
        queryClient,
        placementMutationOptions(scope, async (request) => {
          const groups = workspace.getState().workbenchPanels.editorGroups
          const result = placeTabInGroups(groups, request, {
            groupId: createGroupId(),
            splitId: createSplitId(),
            tabId: createTabId(),
          })
          if (result.status === 'unchanged') return { status: 'applied' }
          if (result.status !== 'applied') {
            return result.status === 'superseded'
              ? { status: 'superseded' }
              : { status: 'unavailable', reason: result.reason }
          }
          if (result.copiedFromTabId)
            documents.getState().copyEditorView(result.copiedFromTabId, result.tabId)
          for (const id of result.removedTabIds) documents.getState().removeEditorView(id)
          publish(result.groups)
          return { status: 'applied' }
        }),
        placement,
      ),
    resizeEditorSplit: (resize) =>
      runMutation(
        queryClient,
        resizeMutationOptions(scope, async (request) => {
          publish(resizeEditorGroups(workspace.getState().workbenchPanels.editorGroups, request))
          return { status: 'applied' }
        }),
        resize,
      ),
    setActiveGroup: async (groupId) => {
      publish(selectEditorGroup(workspace.getState().workbenchPanels.editorGroups, groupId))
      return { status: 'applied' }
    },
    requestMoveTab: (tabId) => ui.getState().setMoveTabId(tabId),
  }
}
