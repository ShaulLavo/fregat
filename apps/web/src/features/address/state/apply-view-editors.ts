import type { EditorGroup, GroupId, GroupNode, SplitChild } from '@/lib/documents/utils/group-types'
import { sameTabContent, tabContentKey } from '@/lib/documents/utils/tabs'
import type { TabContent } from '@/lib/documents/utils/types'
import {
  applicableTabs,
  editorDocumentToken,
  type Address,
} from '@workspace/client-core/address/grammar'
import {
  documentTokenForContent,
  contentForDocumentToken,
} from '@/features/address/utils/document-token'
import { definitionTargetFor } from '@/features/address/utils/definition-target'
import type { AddressApplyReason } from '@/features/address/state/apply-view'
import type { EditorApplyActions } from '@/features/editor/state/apply-actions'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  activeEditorGroup,
  allEditorGroups,
  allEditorTabs,
  groupForTab,
  selectEditorGroupTab,
} from '@/lib/documents/utils/groups'
import {
  activeEditorTabForWorkbenchPanels,
  editorTabRecordsForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
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
    documentTokenForContent(context.rootPath, active.content).kind === 'unaddressable',
  )
  const rejected = applyTabs(context, transient)
  if (transient && active) {
    if (!selectedContentMatches(workspaceStore, active.content))
      commands.openTabContent(active.content)
    return rejected
  }

  const token = editorDocumentToken(address)
  if (token) {
    applyDocument(context, token)
    return rejected
  }
  if (context.reason === 'boot') {
    if (active && !selectedContentMatches(workspaceStore, active.content))
      commands.openTabContent(active.content)
    return rejected
  }

  const state = workspaceStore.getState()
  state.setWorkbenchPanels({
    ...state.workbenchPanels,
    editorGroups: selectEditorGroupTab(
      state.workbenchPanels.editorGroups,
      state.workbenchPanels.editorGroups.activeGroupId,
      null,
    ),
  })
  context.uiStore.setState({ definitionTarget: null, statusBarSource: null })
  return rejected
}

function applyTabs(context: EditorApplyContext, transient: boolean): string | null {
  const { address, rootPath, commands, reason } = context
  // History selects a document; it does not restore an older tab collection.
  if (reason === 'traverse') return null
  if (address.tabs === null) return null
  const tokens = context.complete ? address.tabs : applicableTabs(address.tabs)
  if (!tokens) return 'tab collection exceeds the supported limit'
  const contents = contentsForTabs(tokens, rootPath)
  if (contents === null) return 'tab collection contains an unavailable document'
  const openKeys = new Set(context.workspaceStore.getState().openTabContents.map(tabContentKey))
  const selected = editorDocumentToken(address)
  const anchored = selected ? contentForDocumentToken(rootPath, selected) : null
  for (const content of contents) {
    if (openKeys.has(tabContentKey(content))) continue
    if (transient && anchored?.kind === 'content' && sameTabContent(anchored.content, content))
      continue
    commands.openTabContent(content)
  }
  if (reason === 'boot') return null

  closeTabsOutsideAddress(contents, context)
  // Command addresses flatten several group orders into one content list.
  if (!context.complete) orderTabs(contents, context)
  return null
}

function contentsForTabs(tokens: readonly string[], rootPath: string | null) {
  const contents: TabContent[] = []
  for (const token of tokens) {
    const parsed = contentForDocumentToken(rootPath, token)
    if (parsed.kind !== 'content') return null
    if (!contents.some((content) => sameTabContent(content, parsed.content)))
      contents.push(parsed.content)
  }
  return contents
}

function closeTabsOutsideAddress(contents: readonly TabContent[], context: EditorApplyContext) {
  const { commands, documentStore, rootPath, workspaceStore } = context
  const wanted = new Set(contents.map(tabContentKey))
  const dirty = documentStore.getState().dirtyDocumentKeys
  for (const tab of editorTabRecordsForWorkbenchPanels(workspaceStore.getState().workbenchPanels)) {
    if (wanted.has(tabContentKey(tab.content))) continue
    if (documentTokenForContent(rootPath, tab.content).kind !== 'token') continue
    if (isEditorTabDirty(tab.content, dirty)) continue
    commands.closeTab(tab.id)
  }
}

function orderTabs(contents: readonly TabContent[], { workspaceStore }: EditorApplyContext) {
  const state = workspaceStore.getState()
  const order = new Map(contents.map((content, index) => [tabContentKey(content), index]))
  const editorGroups = state.workbenchPanels.editorGroups
  const replacements = new Map(
    allEditorGroups(editorGroups).map((group) => [
      group.id,
      {
        ...group,
        tabs: [...group.tabs].sort(
          (a, b) =>
            (order.get(tabContentKey(a.content)) ?? Infinity) -
            (order.get(tabContentKey(b.content)) ?? Infinity),
        ),
      },
    ]),
  )
  const root = reorderGroups(editorGroups.root, replacements)
  state.setWorkbenchPanels({ ...state.workbenchPanels, editorGroups: { ...editorGroups, root } })
}

function applyDocument(context: EditorApplyContext, token: string) {
  const { address, commands, rootPath, uiStore } = context
  const parsed = contentForDocumentToken(rootPath, token)
  if (parsed.kind !== 'content') return
  if (!context.complete) selectExistingContent(context, parsed.content)
  if (
    address.focus &&
    parsed.content.kind === 'document' &&
    parsed.content.document.kind === 'file'
  ) {
    commands.openDefinition(
      definitionTargetFor(parsed.content.document.resource.path, address.focus),
    )
    return
  }
  if (!selectedContentMatches(context.workspaceStore, parsed.content))
    commands.openTabContent(parsed.content)
  if (context.reason !== 'boot') uiStore.setState({ definitionTarget: null })
}

function selectExistingContent(context: EditorApplyContext, content: TabContent) {
  const groups = context.workspaceStore.getState().workbenchPanels.editorGroups
  const tab =
    activeEditorGroup(groups).tabs.find((entry) => sameTabContent(entry.content, content)) ??
    allEditorTabs(groups).find((entry) => sameTabContent(entry.content, content))
  if (!tab) return
  const group = groupForTab(groups, tab.id)
  if (group) context.commands.selectTab({ groupId: group.id, tabId: tab.id })
}

function selectedContentMatches(store: EditorWorkspaceStoreApi, content: TabContent): boolean {
  const selected = store.getState().selectedTabContent
  return selected !== null && sameTabContent(selected, content)
}

function reorderGroups(node: GroupNode, groups: ReadonlyMap<GroupId, EditorGroup>): GroupNode {
  if (node.kind === 'group') return groups.get(node.id) ?? node
  const [first, second, ...rest] = node.children
  const child = (entry: SplitChild) => ({ ...entry, node: reorderGroups(entry.node, groups) })
  return { ...node, children: [child(first), child(second), ...rest.map(child)] }
}
