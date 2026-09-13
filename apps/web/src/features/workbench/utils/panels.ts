import { activeEditorTabId } from '@/lib/documents/utils/active-tab'
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
import {
  createTerminalTabRecord,
  type TerminalTabRecord,
} from '@/features/workbench/utils/terminal-tabs'

export type WorkbenchSidebarTab = 'chat' | 'files' | 'git' | 'logs' | 'search'
export type WorkbenchBottomTab = 'terminal' | 'problems'

export type WorkbenchPanels = {
  readonly activeBottomTab: WorkbenchBottomTab
  readonly activeEditorTabId: TabId | null
  readonly activeSidebarTab: WorkbenchSidebarTab
  readonly activeTerminalTabId: string | null
  readonly bottomPanelOpen: boolean
  readonly editorTabs: readonly EditorTabRecord[]
  readonly sidebarOpen: boolean
  /** Last id number handed out; ids never repeat within a workspace. */
  readonly terminalTabSequence: number
  readonly terminalTabs: readonly TerminalTabRecord[]
}

export type TerminalTabDirection = 'next' | 'previous'

export const SIDEBAR_MIN_SIZE = 220
export const SIDEBAR_MAX_SIZE = 520
export const BOTTOM_MIN_SIZE = 140
export const BOTTOM_MAX_SIZE = 480

export function createDefaultWorkbenchPanels(): WorkbenchPanels {
  const terminal = createTerminalTabRecord([], 1)
  return {
    activeBottomTab: 'terminal',
    activeEditorTabId: null,
    activeSidebarTab: 'files',
    activeTerminalTabId: terminal.id,
    bottomPanelOpen: true,
    editorTabs: [],
    sidebarOpen: true,
    terminalTabSequence: 1,
    terminalTabs: [terminal],
  }
}

export function openTerminalTabInWorkbenchPanels(panels: WorkbenchPanels): WorkbenchPanels {
  const terminalTabSequence = panels.terminalTabSequence + 1
  const tab = createTerminalTabRecord(panels.terminalTabs, terminalTabSequence)
  return {
    ...panels,
    activeTerminalTabId: tab.id,
    terminalTabSequence,
    terminalTabs: [...panels.terminalTabs, tab],
  }
}

export function closeTerminalTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
): WorkbenchPanels {
  const index = panels.terminalTabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return panels

  const terminalTabs = panels.terminalTabs.filter((tab) => tab.id !== tabId)
  return {
    ...panels,
    activeTerminalTabId: activeTerminalTabIdAfterClose(panels, terminalTabs, index, tabId),
    terminalTabs,
  }
}

export function renameTerminalTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
  name: string,
): WorkbenchPanels {
  const trimmed = name.trim()
  return patchTerminalTab(panels, tabId, {
    name: trimmed.length === 0 ? null : trimmed,
  })
}

export function setTerminalTabShellTitleInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
  shellTitle: string,
): WorkbenchPanels {
  const trimmed = shellTitle.trim()
  return patchTerminalTab(panels, tabId, {
    shellTitle: trimmed.length === 0 ? null : trimmed,
  })
}

export function setTerminalTabProcessInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
  process: string | null,
): WorkbenchPanels {
  return patchTerminalTab(panels, tabId, { process })
}

function patchTerminalTab(
  panels: WorkbenchPanels,
  tabId: string,
  patch: Partial<Pick<TerminalTabRecord, 'name' | 'process' | 'shellTitle'>>,
): WorkbenchPanels {
  const tab = terminalTabById(panels, tabId)
  if (!tab) return panels
  const next = { ...tab, ...patch }
  if (next.name === tab.name && next.process === tab.process && next.shellTitle === tab.shellTitle)
    return panels

  return {
    ...panels,
    terminalTabs: panels.terminalTabs.map((item) => (item.id === tabId ? next : item)),
  }
}

export function selectTerminalTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
): WorkbenchPanels {
  if (!terminalTabById(panels, tabId)) return panels
  if (panels.activeTerminalTabId === tabId) return panels

  return { ...panels, activeTerminalTabId: tabId }
}

export function selectAdjacentTerminalTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  direction: TerminalTabDirection,
): WorkbenchPanels {
  const count = panels.terminalTabs.length
  if (count < 2) return panels

  const current = panels.terminalTabs.findIndex((tab) => tab.id === panels.activeTerminalTabId)
  const step = direction === 'next' ? 1 : -1
  const next = panels.terminalTabs[(current + step + count) % count]
  if (!next) return panels

  return selectTerminalTabInWorkbenchPanels(panels, next.id)
}

export function reorderTerminalTabInWorkbenchPanels(
  panels: WorkbenchPanels,
  tabId: string,
  targetIndex: number,
): WorkbenchPanels {
  const terminalTabs = reorderedTabs(panels.terminalTabs, tabId, targetIndex)
  if (terminalTabs === panels.terminalTabs) return panels

  return { ...panels, terminalTabs }
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
  const editorTabs = reorderedTabs(panels.editorTabs, tabId, targetIndex)
  if (editorTabs === panels.editorTabs) return panels

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
    activeTerminalTabId: normalizedActiveTerminalTabId(value),
    bottomPanelOpen: value.bottomPanelOpen,
    editorTabs: value.editorTabs,
    sidebarOpen: value.sidebarOpen,
    terminalTabSequence: value.terminalTabSequence,
    terminalTabs: value.terminalTabs,
  }
}

function editorTabById(panels: WorkbenchPanels, tabId: TabId) {
  return panels.editorTabs.find((tab) => tab.id === tabId) ?? null
}

function terminalTabById(panels: WorkbenchPanels, tabId: string) {
  return panels.terminalTabs.find((tab) => tab.id === tabId) ?? null
}

// Unlike editor tabs, falls back to the first tab: a terminal list has no "nothing open" state.
function normalizedActiveTerminalTabId(panels: WorkbenchPanels) {
  if (panels.activeTerminalTabId && terminalTabById(panels, panels.activeTerminalTabId))
    return panels.activeTerminalTabId

  return panels.terminalTabs[0]?.id ?? null
}

function activeTerminalTabIdAfterClose(
  panels: WorkbenchPanels,
  nextTabs: readonly TerminalTabRecord[],
  closedIndex: number,
  closedTabId: string,
) {
  if (panels.activeTerminalTabId !== closedTabId) return panels.activeTerminalTabId

  return nextTabs[Math.min(closedIndex, nextTabs.length - 1)]?.id ?? null
}

function activeEditorTabIdAfterClose(
  panels: WorkbenchPanels,
  nextTabs: readonly EditorTabRecord[],
  closedIndex: number,
  closedTabId: TabId,
) {
  if (panels.activeEditorTabId !== closedTabId)
    return activeEditorTabId(nextTabs, panels.activeEditorTabId, {
      fallbackToFirstWhenUnset: false,
    })

  return nextTabs[Math.min(closedIndex, nextTabs.length - 1)]?.id ?? null
}

function activeEditorTabIdAfterPathClose(
  panels: WorkbenchPanels,
  nextTabs: readonly EditorTabRecord[],
) {
  return activeEditorTabId(nextTabs, panels.activeEditorTabId, {
    fallbackToFirstWhenUnset: false,
  })
}

function normalizedActiveTabId(panels: WorkbenchPanels) {
  return activeEditorTabId(panels.editorTabs, panels.activeEditorTabId, {
    fallbackToFirstWhenUnset: false,
  })
}

/** Returns the same array for a no-op so callers can keep the panels object referentially stable. */
function reorderedTabs<Tab extends { readonly id: string }>(
  tabs: readonly Tab[],
  tabId: string,
  targetIndex: number,
): readonly Tab[] {
  const sourceIndex = tabs.findIndex((tab) => tab.id === tabId)
  if (sourceIndex < 0) return tabs
  if (sourceIndex === targetIndex) return tabs

  const next = [...tabs]
  const [tab] = next.splice(sourceIndex, 1)
  if (!tab) return tabs

  next.splice(clampedInsertionIndex(targetIndex, next.length), 0, tab)
  return next
}

function clampedInsertionIndex(index: number, length: number) {
  return clamp(index, 0, length)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
