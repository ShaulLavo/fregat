import type { EditorGroups } from '@/lib/documents/utils/group-types'
import {
  activeEditorTab,
  allEditorTabs,
  closeTabInGroups,
  createEditorGroups,
  filterGroupTabs,
  groupForTab,
  mapGroupTabs,
  normalizeEditorGroups,
  openTabInGroups,
  selectEditorGroupTab,
} from '@/lib/documents/utils/groups'
import { createDefaultGitHistoryView, type GitHistoryView } from '@/lib/git-history-view'
import {
  createEditorTabRecord,
  rekeyTabFile,
  sameTabContent,
  tabContentKey,
} from '@/lib/documents/utils/tabs'
import type { FilesystemPath, TabContent, TabId } from '@/lib/documents/utils/types'
import {
  createTerminalTabRecord,
  type TerminalTabRecord,
} from '@/features/workbench/utils/terminal-tabs'

export type WorkbenchSidebarTab = 'chat' | 'files' | 'git' | 'logs' | 'search'

export const WORKBENCH_SIDEBAR_TABS: readonly WorkbenchSidebarTab[] = [
  'files',
  'git',
  'search',
  'logs',
  'chat',
]
export type WorkbenchBottomTab = 'terminal' | 'problems'

export const WORKBENCH_BOTTOM_TABS: readonly WorkbenchBottomTab[] = ['terminal', 'problems']

export type WorkbenchPanels = {
  readonly activeBottomTab: WorkbenchBottomTab
  readonly activeGitTab: 'changes' | 'graph'
  readonly activeSidebarTab: WorkbenchSidebarTab
  readonly activeTerminalTabId: string | null
  readonly bottomPanelOpen: boolean
  readonly editorGroups: EditorGroups
  readonly gitCommitDetailsOpen: boolean
  readonly gitHistory: GitHistoryView
  readonly gitChangesOpen: { readonly staged: boolean; readonly worktree: boolean }
  readonly sidebarOpen: boolean
  /** The tab rail; toggle-sidebar hides it with the pane, a rail click hides the pane alone. */
  readonly sidebarRailOpen: boolean
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
    activeGitTab: 'changes',
    activeSidebarTab: 'files',
    activeTerminalTabId: terminal.id,
    bottomPanelOpen: true,
    editorGroups: createEditorGroups(),
    gitCommitDetailsOpen: true,
    gitHistory: createDefaultGitHistoryView(),
    gitChangesOpen: { staged: true, worktree: true },
    sidebarOpen: true,
    sidebarRailOpen: true,
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
  return activeEditorTab(panels.editorGroups)
}

export function editorOpenContentsForWorkbenchPanels(panels: WorkbenchPanels) {
  return Array.from(
    new Map(
      allEditorTabs(panels.editorGroups).map((tab) => [tabContentKey(tab.content), tab.content]),
    ).values(),
  )
}

export function editorContentCountsForWorkbenchPanels(panels: WorkbenchPanels) {
  const counts = new Map<string, number>()
  for (const tab of allEditorTabs(panels.editorGroups)) {
    const key = tabContentKey(tab.content)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}

export function editorTabRecordsForWorkbenchPanels(panels: WorkbenchPanels) {
  return allEditorTabs(panels.editorGroups)
}

export function openEditorContentInWorkbenchPanels(panels: WorkbenchPanels, content: TabContent) {
  return withEditorGroups(
    panels,
    openTabInGroups(panels.editorGroups, createEditorTabRecord(content)),
  )
}

export function closeEditorTabInWorkbenchPanels(panels: WorkbenchPanels, tabId: TabId) {
  return withEditorGroups(panels, closeTabInGroups(panels.editorGroups, tabId))
}

export function closeEditorContentInWorkbenchPanels(panels: WorkbenchPanels, content: TabContent) {
  return withEditorGroups(
    panels,
    filterGroupTabs(panels.editorGroups, (tab) => !sameTabContent(tab.content, content)),
  )
}

export function renameEditorFileInWorkbenchPanels(
  panels: WorkbenchPanels,
  from: FilesystemPath,
  to: FilesystemPath,
): WorkbenchPanels {
  const editorGroups = mapGroupTabs(panels.editorGroups, (tab) => {
    const content = rekeyTabFile(tab.content, from, to)
    if (content === tab.content) return tab
    return { ...tab, content }
  })
  return withEditorGroups(panels, editorGroups)
}

export function selectEditorTabInWorkbenchPanels(panels: WorkbenchPanels, tabId: TabId) {
  const group = groupForTab(panels.editorGroups, tabId)
  if (!group) return panels
  return withEditorGroups(panels, selectEditorGroupTab(panels.editorGroups, group.id, tabId))
}

function withEditorGroups(panels: WorkbenchPanels, editorGroups: EditorGroups): WorkbenchPanels {
  if (editorGroups === panels.editorGroups) return panels
  return { ...panels, editorGroups }
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

/** Shows or hides the whole sidebar, rail included, and keeps its selected tab. */
export function setWorkbenchSidebarOpen(panels: WorkbenchPanels, open: boolean): WorkbenchPanels {
  if (panels.sidebarOpen === open && panels.sidebarRailOpen === open) return panels

  return { ...panels, sidebarOpen: open, sidebarRailOpen: open }
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
  if (panels.sidebarOpen && panels.sidebarRailOpen && panels.activeSidebarTab === activeSidebarTab)
    return panels

  return { ...panels, activeSidebarTab, sidebarOpen: true, sidebarRailOpen: true }
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
    activeGitTab: value.activeGitTab,
    activeSidebarTab: value.activeSidebarTab,
    activeTerminalTabId: normalizedActiveTerminalTabId(value),
    bottomPanelOpen: value.bottomPanelOpen,
    editorGroups: normalizeEditorGroups(value.editorGroups),
    gitCommitDetailsOpen: value.gitCommitDetailsOpen,
    gitHistory: value.gitHistory,
    gitChangesOpen: value.gitChangesOpen,
    sidebarOpen: value.sidebarOpen,
    sidebarRailOpen: value.sidebarRailOpen,
    terminalTabSequence: value.terminalTabSequence,
    terminalTabs: value.terminalTabs,
  }
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

export function workbenchSidebarTabLabel(tab: WorkbenchSidebarTab) {
  if (tab === 'chat') return 'Chat'
  if (tab === 'git') return 'Git'
  if (tab === 'logs') return 'Logs'
  if (tab === 'search') return 'Search'

  return 'Files'
}

export function workbenchBottomTabLabel(tab: WorkbenchBottomTab) {
  return tab === 'problems' ? 'Problems' : 'Terminal'
}
