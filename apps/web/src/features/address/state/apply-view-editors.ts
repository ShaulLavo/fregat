import {
  applicableTabs,
  editorDocumentToken,
  type Address,
} from '@workspace/client-core/address/grammar'
import { documentTokenForPath, pathForDocumentToken } from '@/features/address/utils/document-token'
import { definitionTargetFor } from '@/features/address/utils/definition-target'
import type { AddressApplyReason } from '@/features/address/state/apply-view'
import type { EditorApplyActions } from '@/features/editor/state/apply-actions'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'

type EditorApplyContext = {
  readonly address: Address
  readonly rootPath: string | null
  readonly commands: EditorApplyActions
  readonly workspaceStore: EditorWorkspaceStoreApi
  readonly documentStore: EditorDocumentStoreApi
  readonly uiStore: EditorUiStoreApi
  readonly reason: AddressApplyReason
  readonly preserveTransient: boolean
  readonly complete: boolean
}

export function applyAddressEditors(context: EditorApplyContext) {
  const { address, commands, workspaceStore, preserveTransient } = context
  const active = activeEditorTabForWorkbenchPanels(workspaceStore.getState().workbenchPanels)
  const transient = Boolean(
    preserveTransient &&
    active &&
    documentTokenForPath(context.rootPath, active.path).kind === 'unaddressable',
  )
  const rejected = applyTabs(context, transient)
  if (transient && active) {
    if (workspaceStore.getState().selectedFilePath !== active.path)
      commands.openFileSurface(active.path)
    return rejected
  }

  const token = editorDocumentToken(address)
  if (token) {
    applyDocument(context, token)
    return rejected
  }
  if (context.reason === 'boot') {
    if (active && workspaceStore.getState().selectedFilePath !== active.path)
      commands.openFileSurface(active.path)
    return rejected
  }

  const state = workspaceStore.getState()
  state.setWorkbenchPanels({ ...state.workbenchPanels, activeEditorTabId: null })
  context.uiStore.setState({ definitionTarget: null, statusBarSource: null })
  return rejected
}

function applyTabs(context: EditorApplyContext, transient: boolean): string | null {
  const { address, rootPath, commands, reason } = context
  if (address.tabs === null) return null
  const tokens = context.complete ? address.tabs : applicableTabs(address.tabs)
  if (!tokens) return 'tab collection exceeds the supported limit'
  const paths = pathsForTabs(tokens, rootPath)
  if (paths === null) return 'tab collection contains an unavailable document'
  const openPaths = new Set(context.workspaceStore.getState().openFilePaths)
  const selected = editorDocumentToken(address)
  const anchored = selected ? pathForDocumentToken(rootPath, selected) : null
  for (const path of paths) {
    if (openPaths.has(path)) continue
    if (transient && anchored?.kind === 'path' && anchored.path === path) continue
    commands.openFileSurface(path)
  }
  if (reason === 'boot') return null

  closeTabsOutsideAddress(paths, context)
  orderTabs(paths, context)
  return null
}

function pathsForTabs(tokens: readonly string[], rootPath: string | null) {
  const paths: string[] = []
  for (const token of tokens) {
    const parsed = pathForDocumentToken(rootPath, token)
    if (parsed.kind !== 'path') return null
    if (!paths.includes(parsed.path)) paths.push(parsed.path)
  }
  return paths
}

function closeTabsOutsideAddress(paths: readonly string[], context: EditorApplyContext) {
  const { commands, documentStore, rootPath, workspaceStore } = context
  const wanted = new Set(paths)
  const dirty = documentStore.getState().dirtyFilePaths
  for (const tab of workspaceStore.getState().workbenchPanels.editorTabs) {
    if (wanted.has(tab.path)) continue
    if (documentTokenForPath(rootPath, tab.path).kind !== 'token') continue
    if (isEditorTabDirty(tab.path, dirty)) continue
    commands.closeTab(tab.id)
  }
}

function orderTabs(paths: readonly string[], { workspaceStore }: EditorApplyContext) {
  const state = workspaceStore.getState()
  const tabs = state.workbenchPanels.editorTabs
  const byPath = new Map(tabs.map((tab) => [tab.path, tab]))
  const addressed = paths.flatMap((path) => {
    const tab = byPath.get(path)
    return tab ? [tab] : []
  })
  const wanted = new Set(paths)
  const extras = tabs.filter((tab) => !wanted.has(tab.path))
  const editorTabs = [...addressed, ...extras]
  if (tabs.every((tab, index) => tab === editorTabs[index])) return
  state.setWorkbenchPanels({ ...state.workbenchPanels, editorTabs })
}

function applyDocument(context: EditorApplyContext, token: string) {
  const { address, commands, rootPath, uiStore } = context
  const parsed = pathForDocumentToken(rootPath, token)
  if (parsed.kind !== 'path') return
  if (address.focus) {
    commands.openDefinition(definitionTargetFor(parsed.path, address.focus))
    return
  }
  if (context.workspaceStore.getState().selectedFilePath !== parsed.path)
    commands.openFileSurface(parsed.path)
  if (context.reason !== 'boot') uiStore.setState({ definitionTarget: null })
}
