import {
  createEditorTabRecord,
  rekeyTabFile,
  sameTabContent,
  tabContentKey,
} from '@/lib/documents/utils/tabs'
import type {
  EditorTabRecord,
  FilesystemPath,
  TabContent,
  TabId,
} from '@/lib/documents/utils/types'

export type WorkbenchSidebarTab = 'chat' | 'files' | 'git' | 'logs' | 'search'
export type WorkbenchBottomTab = 'terminal' | 'problems'

export type WorkbenchPanels = {
  readonly activeBottomTab: WorkbenchBottomTab
  readonly activeEditorTabId: TabId | null
  readonly activeSidebarTab: WorkbenchSidebarTab
  readonly bottomPanelOpen: boolean
  readonly editorTabs: readonly EditorTabRecord[]
  readonly sidebarOpen: boolean
}

export const SIDEBAR_MIN_SIZE = 220
export const SIDEBAR_MAX_SIZE = 520
export const BOTTOM_MIN_SIZE = 140
export const BOTTOM_MAX_SIZE = 480

export function createDefaultWorkbenchPanels(): WorkbenchPanels {
  return {
    activeBottomTab: 'terminal',
    activeEditorTabId: null,
    activeSidebarTab: 'files',
    bottomPanelOpen: true,
    editorTabs: [],
    sidebarOpen: true,
  }
}

export function activeEditorContentForWorkbenchPanels(panels: WorkbenchPanels) {
  return activeEditorTabForWorkbenchPanels(panels)?.content ?? null
}

export function activeEditorTabForWorkbenchPanels(panels: WorkbenchPanels) {
  if (!panels.activeEditorTabId) return null

  return editorTabById(panels, panels.activeEditorTabId) ?? panels.editorTabs[0] ?? null
}

export function editorOpenContentsForWorkbenchPanels(panels: WorkbenchPanels) {
  return Array.from(
    new Map(panels.editorTabs.map((tab) => [tabContentKey(tab.content), tab.content])).values(),
  )
}

export function editorContentCountsForWorkbenchPanels(panels: WorkbenchPanels) {
  const counts = new Map<string, number>()
  for (const tab of panels.editorTabs) {
    const key = tabContentKey(tab.content)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}

export function editorTabRecordsForWorkbenchPanels(panels: WorkbenchPanels) {
  return panels.editorTabs
}

export function openEditorContentInWorkbenchPanels(panels: WorkbenchPanels, content: TabContent) {
  const existing = panels.editorTabs.find((tab) => sameTabContent(tab.content, content))
  if (existing) return selectEditorTabInWorkbenchPanels(panels, existing.id)

  const tab = createEditorTabRecord(content)
  return {
    ...panels,
    activeEditorTabId: tab.id,
    editorTabs: [...panels.editorTabs, tab],
  }
}

export function closeEditorTabInWorkbenchPanels(panels: WorkbenchPanels, tabId: TabId) {
  const index = panels.editorTabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return panels

  const editorTabs = panels.editorTabs.filter((tab) => tab.id !== tabId)
  return {
    ...panels,
    activeEditorTabId: activeEditorTabIdAfterClose(panels, editorTabs, index, tabId),
    editorTabs,
  }
}

export function closeEditorContentInWorkbenchPanels(panels: WorkbenchPanels, content: TabContent) {
  const editorTabs = panels.editorTabs.filter((tab) => !sameTabContent(tab.content, content))
  if (editorTabs.length === panels.editorTabs.length) return panels

  return {
    ...panels,
    activeEditorTabId: activeEditorTabIdAfterPathClose(panels, editorTabs),
    editorTabs,
  }
}

export function renameEditorFileInWorkbenchPanels(
  panels: WorkbenchPanels,
  from: FilesystemPath,
  to: FilesystemPath,
): WorkbenchPanels {
  let renamed = false
  const editorTabs = panels.editorTabs.map((tab) => {
    const content = rekeyTabFile(tab.content, from, to)
    if (content === tab.content) return tab

    renamed = true
    return { ...tab, content }
  })
  if (!renamed) return panels

  return { ...panels, editorTabs }
}

export function reorderEditorTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: TabId,
  targetIndex: number,
) {
  const sourceIndex = panels.editorTabs.findIndex((tab) => tab.id === tabId)
  if (sourceIndex < 0) return panels
  if (sourceIndex === targetIndex) return panels

  const editorTabs = [...panels.editorTabs]
  const [tab] = editorTabs.splice(sourceIndex, 1)
  if (!tab) return panels

  editorTabs.splice(clampedInsertionIndex(targetIndex, editorTabs.length), 0, tab)
  return { ...panels, editorTabs }
}

export function selectEditorTabInWorkbenchPanels(panels: WorkbenchPanels, tabId: TabId) {
  if (!editorTabById(panels, tabId)) return panels
  if (panels.activeEditorTabId === tabId) return panels

  return { ...panels, activeEditorTabId: tabId }
}

export function setWorkbenchSidebarTab(
  panels: WorkbenchPanels,
  activeSidebarTab: WorkbenchSidebarTab,
) {
  if (panels.activeSidebarTab === activeSidebarTab) return panels

  return { ...panels, activeSidebarTab }
}

export function setWorkbenchBottomTab(
  panels: WorkbenchPanels,
  activeBottomTab: WorkbenchBottomTab,
) {
  if (panels.activeBottomTab === activeBottomTab) return panels

  return { ...panels, activeBottomTab }
}

/**
 * The visibility half of the pane commands: pressing the shortcut for the tab
 * already showing hides the pane, anything else reveals that tab.
 */
export function toggleWorkbenchSidebarTab(
  panels: WorkbenchPanels,
  activeSidebarTab: WorkbenchSidebarTab,
): WorkbenchPanels {
  if (panels.sidebarOpen && panels.activeSidebarTab === activeSidebarTab) {
    return { ...panels, sidebarOpen: false }
  }

  return showWorkbenchSidebarTab(panels, activeSidebarTab)
}

/** Reveals a tab without the toggle behaviour, for code that opens the pane on the user's behalf. */
export function showWorkbenchSidebarTab(
  panels: WorkbenchPanels,
  activeSidebarTab: WorkbenchSidebarTab,
): WorkbenchPanels {
  if (panels.sidebarOpen && panels.activeSidebarTab === activeSidebarTab) return panels

  return { ...panels, activeSidebarTab, sidebarOpen: true }
}

export function toggleWorkbenchBottomTab(
  panels: WorkbenchPanels,
  activeBottomTab: WorkbenchBottomTab,
): WorkbenchPanels {
  if (panels.bottomPanelOpen && panels.activeBottomTab === activeBottomTab) {
    return { ...panels, bottomPanelOpen: false }
  }

  return showWorkbenchBottomTab(panels, activeBottomTab)
}

/** Reveals a tab without the toggle behaviour, for code that opens the pane on the user's behalf. */
export function showWorkbenchBottomTab(
  panels: WorkbenchPanels,
  activeBottomTab: WorkbenchBottomTab,
): WorkbenchPanels {
  if (panels.bottomPanelOpen && panels.activeBottomTab === activeBottomTab) return panels

  return { ...panels, activeBottomTab, bottomPanelOpen: true }
}

export function normalizeWorkbenchPanels(value: WorkbenchPanels): WorkbenchPanels {
  return {
    activeBottomTab: value.activeBottomTab,
    activeEditorTabId: normalizedActiveTabId(value),
    activeSidebarTab: value.activeSidebarTab,
    bottomPanelOpen: value.bottomPanelOpen,
    editorTabs: value.editorTabs,
    sidebarOpen: value.sidebarOpen,
  }
}

function editorTabById(panels: WorkbenchPanels, tabId: TabId) {
  return panels.editorTabs.find((tab) => tab.id === tabId) ?? null
}

function activeEditorTabIdAfterClose(
  panels: WorkbenchPanels,
  nextTabs: readonly EditorTabRecord[],
  closedIndex: number,
  closedTabId: TabId,
) {
  if (panels.activeEditorTabId !== closedTabId) return normalizedActiveTabIdFor(nextTabs, panels)

  return nextTabs[Math.min(closedIndex, nextTabs.length - 1)]?.id ?? null
}

function activeEditorTabIdAfterPathClose(
  panels: WorkbenchPanels,
  nextTabs: readonly EditorTabRecord[],
) {
  return normalizedActiveTabIdFor(nextTabs, panels)
}

function normalizedActiveTabId(panels: WorkbenchPanels) {
  return normalizedActiveTabIdFor(panels.editorTabs, panels)
}

function normalizedActiveTabIdFor(
  tabs: readonly EditorTabRecord[],
  panels: Pick<WorkbenchPanels, 'activeEditorTabId'>,
) {
  if (!panels.activeEditorTabId) return null
  if (tabs.some((tab) => tab.id === panels.activeEditorTabId)) return panels.activeEditorTabId

  return tabs[0]?.id ?? null
}

function clampedInsertionIndex(index: number, length: number) {
  return clamp(index, 0, length)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
