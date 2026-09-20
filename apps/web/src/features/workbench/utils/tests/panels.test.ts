import { describe } from 'vitest'
import { test as it, expect } from '../../../../../test/fixtures'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { activeEditorGroup, selectEditorGroupTab } from '@/lib/documents/utils/groups'
import { testTabContent, testTabContents } from '../../../../../test/factories/document-targets'

import {
  activeEditorTabForWorkbenchPanels,
  editorTabRecordsForWorkbenchPanels,
  closeEditorContentInWorkbenchPanels,
  closeEditorTabInWorkbenchPanels,
  closeTerminalTabInWorkbenchPanels,
  createDefaultWorkbenchPanels,
  normalizeWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
  openTerminalTabInWorkbenchPanels,
  renameEditorFileInWorkbenchPanels,
  renameTerminalTabInWorkbenchPanels,
  setTerminalTabProcessInWorkbenchPanels,
  setTerminalTabShellTitleInWorkbenchPanels,
  reorderTerminalTabInWorkbenchPanels,
  selectAdjacentTerminalTabInWorkbenchPanels,
  selectEditorTabInWorkbenchPanels,
  selectTerminalTabInWorkbenchPanels,
  setWorkbenchBottomTab,
  setWorkbenchSidebarTab,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { terminalTabLabel } from '@/features/workbench/utils/terminal-tabs'

describe('workbench panel-state model', () => {
  it('creates default panels', () => {
    expect(createDefaultWorkbenchPanels()).toMatchObject({
      activeBottomTab: 'terminal',
      activeSidebarTab: 'files',
      editorGroups: { root: { kind: 'group', tabs: [], selectedTabId: null } },
    })
  })

  it('opens a new path as the active tab', () => {
    const panels = openEditorContentInWorkbenchPanels(
      createDefaultWorkbenchPanels(),
      testTabContent('/repo/a.ts'),
    )

    expect(editorTabRecordsForWorkbenchPanels(panels)).toHaveLength(1)
    expect(editorTabRecordsForWorkbenchPanels(panels)[0]?.content).toEqual(
      testTabContent('/repo/a.ts'),
    )
    expect(activeEditorTabForWorkbenchPanels(panels)?.id ?? null).toBe(
      editorTabRecordsForWorkbenchPanels(panels)[0]?.id,
    )
  })

  it('selects an already-open path without adding a tab', () => {
    let panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    panels = openEditorContentInWorkbenchPanels(panels, testTabContent('/repo/a.ts'))

    expect(editorTabRecordsForWorkbenchPanels(panels)).toHaveLength(2)
    expect(activeEditorTabForWorkbenchPanels(panels)?.id ?? null).toBe(editorTabIdAt(panels, 0))
  })

  it('keeps select operations inert when the tab is absent or already active', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts'])
    const activeTabId = editorTabIdAt(panels, 0)

    expect(selectEditorTabInWorkbenchPanels(panels, tabId('missing-tab'))).toBe(panels)
    expect(selectEditorTabInWorkbenchPanels(panels, activeTabId)).toBe(panels)
  })

  it('selects an existing inactive editor tab', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    const firstTabId = editorTabIdAt(panels, 0)
    const result = selectEditorTabInWorkbenchPanels(panels, firstTabId)

    expect(result).not.toBe(panels)
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(firstTabId)
  })

  it('renames matching editor paths', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    const result = renameEditorFileInWorkbenchPanels(
      panels,
      filesystemPath('/repo/a.ts'),
      filesystemPath('/repo/renamed.ts'),
    )

    expect(editorTabContents(result)).toEqual(testTabContents(['/repo/renamed.ts', '/repo/b.ts']))
  })

  it('keeps missing editor path renames referentially stable', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts'])

    expect(
      renameEditorFileInWorkbenchPanels(
        panels,
        filesystemPath('/repo/missing.ts'),
        filesystemPath('/repo/renamed.ts'),
      ),
    ).toBe(panels)
  })

  it('activates the tab now at the same index after closing the active middle tab', () => {
    let panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'])
    panels = openEditorContentInWorkbenchPanels(panels, testTabContent('/repo/b.ts'))
    const middleTabId = editorTabIdAt(panels, 1)
    const lastTabId = editorTabIdAt(panels, 2)
    const result = closeEditorTabInWorkbenchPanels(panels, middleTabId)

    expect(editorTabContents(result)).toEqual(testTabContents(['/repo/a.ts', '/repo/c.ts']))
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(lastTabId)
  })

  it('activates the new last tab after closing the active last tab', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'])
    const activeLastTabId = editorTabIdAt(panels, 2)
    const previousTabId = editorTabIdAt(panels, 1)
    const result = closeEditorTabInWorkbenchPanels(panels, activeLastTabId)

    expect(editorTabContents(result)).toEqual(testTabContents(['/repo/a.ts', '/repo/b.ts']))
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(previousTabId)
  })

  it('clears the active editor tab after closing the only tab', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts'])
    const tabId = editorTabIdAt(panels, 0)
    const result = closeEditorTabInWorkbenchPanels(panels, tabId)

    expect(editorTabRecordsForWorkbenchPanels(result)).toEqual([])
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBeNull()
  })

  it('preserves the active editor tab after closing a non-active tab', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'])
    const firstTabId = editorTabIdAt(panels, 0)
    const activeTabId = editorTabIdAt(panels, 2)
    const result = closeEditorTabInWorkbenchPanels(panels, firstTabId)

    expect(editorTabContents(result)).toEqual(testTabContents(['/repo/b.ts', '/repo/c.ts']))
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(activeTabId)
  })

  it('keeps absent close-tab operations referentially stable', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts'])

    expect(closeEditorTabInWorkbenchPanels(panels, tabId('missing-tab'))).toBe(panels)
  })

  it('closes every editor tab with a matching path', () => {
    const panels = renameEditorFileInWorkbenchPanels(
      workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts']),
      filesystemPath('/repo/b.ts'),
      filesystemPath('/repo/a.ts'),
    )
    const result = closeEditorContentInWorkbenchPanels(panels, testTabContent('/repo/a.ts'))

    expect(editorTabRecordsForWorkbenchPanels(result)).toEqual([])
    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBeNull()
  })

  it('keeps absent close-path operations referentially stable', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts'])

    expect(closeEditorContentInWorkbenchPanels(panels, testTabContent('/repo/missing.ts'))).toBe(
      panels,
    )
  })

  it('sets sidebar and bottom tabs while keeping current values referentially stable', () => {
    const panels = createDefaultWorkbenchPanels()
    const sidebarResult = setWorkbenchSidebarTab(panels, 'git')
    const bottomResult = setWorkbenchBottomTab(panels, 'problems')

    expect(sidebarResult).not.toBe(panels)
    expect(sidebarResult.activeSidebarTab).toBe('git')
    expect(setWorkbenchSidebarTab(panels, 'files')).toBe(panels)
    expect(bottomResult).not.toBe(panels)
    expect(bottomResult.activeBottomTab).toBe('problems')
    expect(setWorkbenchBottomTab(panels, 'terminal')).toBe(panels)
  })

  it('preserves an unset selection even when editor tabs remain', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    const result = normalizeWorkbenchPanels({
      ...panels,
      editorGroups: selectEditorGroupTab(
        panels.editorGroups,
        panels.editorGroups.activeGroupId,
        null,
      ),
    })

    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBeNull()
    expect(editorTabRecordsForWorkbenchPanels(result)).toHaveLength(2)
  })

  it('normalizes a stale active editor id', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    const firstTabId = editorTabIdAt(panels, 0)
    const result = normalizeWorkbenchPanels({
      ...panels,
      editorGroups: {
        ...panels.editorGroups,
        root: { ...activeEditorGroup(panels.editorGroups), selectedTabId: tabId('missing-tab') },
      },
    })

    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(firstTabId)
  })

  it('normalizes stale active editor ids to null when no tabs exist', () => {
    const panels = createDefaultWorkbenchPanels()
    const result = normalizeWorkbenchPanels({
      ...createDefaultWorkbenchPanels(),
      editorGroups: {
        ...panels.editorGroups,
        root: { ...activeEditorGroup(panels.editorGroups), selectedTabId: tabId('missing-tab') },
      },
    })

    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBeNull()
  })

  it('preserves valid active editor ids while normalizing panels', () => {
    const panels = workbenchPanelsForPaths(['/repo/a.ts', '/repo/b.ts'])
    const activeTabId = editorTabIdAt(panels, 1)
    const result = normalizeWorkbenchPanels(panels)

    expect(activeEditorTabForWorkbenchPanels(result)?.id ?? null).toBe(activeTabId)
  })
})

function workbenchPanelsForPaths(paths: readonly string[]) {
  let panels = createDefaultWorkbenchPanels()
  for (const path of paths)
    panels = openEditorContentInWorkbenchPanels(panels, testTabContent(path))

  return panels
}

function editorTabIdAt(panels: WorkbenchPanels, index: number) {
  const id = editorTabRecordsForWorkbenchPanels(panels)[index]?.id
  expect(id).toEqual(expect.any(String))

  return id ?? expect.unreachable('Expected an editor tab')
}

function editorTabContents(panels: WorkbenchPanels) {
  return editorTabRecordsForWorkbenchPanels(panels).map((tab) => tab.content)
}

describe('workbench terminal tabs', () => {
  it('starts with one terminal selected', () => {
    const panels = createDefaultWorkbenchPanels()

    expect(panels.terminalTabs).toEqual([
      { id: 'terminal-1', name: null, process: null, shellTitle: null, title: 'Terminal 1' },
    ])
    expect(panels.activeTerminalTabId).toBe('terminal-1')
  })

  it('reuses the lowest free title but never an id, and selects the new tab', () => {
    let panels = openTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels())
    panels = openTerminalTabInWorkbenchPanels(panels)
    panels = closeTerminalTabInWorkbenchPanels(panels, 'terminal-2')
    panels = openTerminalTabInWorkbenchPanels(panels)

    expect(panels.terminalTabs.map((tab) => [tab.id, tab.title])).toEqual([
      ['terminal-1', 'Terminal 1'],
      ['terminal-3', 'Terminal 3'],
      ['terminal-4', 'Terminal 2'],
    ])
    expect(panels.activeTerminalTabId).toBe('terminal-4')
    expect(panels.terminalTabSequence).toBe(4)
  })

  it('activates the neighbour after closing the active terminal', () => {
    let panels = openTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels())
    panels = openTerminalTabInWorkbenchPanels(panels)
    panels = selectTerminalTabInWorkbenchPanels(panels, 'terminal-2')

    const closedMiddle = closeTerminalTabInWorkbenchPanels(panels, 'terminal-2')
    expect(closedMiddle.activeTerminalTabId).toBe('terminal-3')

    const closedLast = closeTerminalTabInWorkbenchPanels(closedMiddle, 'terminal-3')
    expect(closedLast.activeTerminalTabId).toBe('terminal-1')
  })

  it('keeps the selection when closing another terminal', () => {
    const panels = openTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels())
    const result = closeTerminalTabInWorkbenchPanels(panels, 'terminal-1')

    expect(result.activeTerminalTabId).toBe('terminal-2')
    expect(closeTerminalTabInWorkbenchPanels(panels, 'missing')).toBe(panels)
  })

  it('leaves no selection once the last terminal closes', () => {
    const result = closeTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels(), 'terminal-1')

    expect(result.terminalTabs).toEqual([])
    expect(result.activeTerminalTabId).toBeNull()
  })

  it('cycles terminals in both directions and wraps', () => {
    let panels = openTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels())
    panels = openTerminalTabInWorkbenchPanels(panels)
    panels = selectTerminalTabInWorkbenchPanels(panels, 'terminal-3')

    expect(selectAdjacentTerminalTabInWorkbenchPanels(panels, 'next').activeTerminalTabId).toBe(
      'terminal-1',
    )
    expect(selectAdjacentTerminalTabInWorkbenchPanels(panels, 'previous').activeTerminalTabId).toBe(
      'terminal-2',
    )
    const single = createDefaultWorkbenchPanels()
    expect(selectAdjacentTerminalTabInWorkbenchPanels(single, 'next')).toBe(single)
  })

  it('reorders terminals and keeps no-ops referentially stable', () => {
    let panels = openTerminalTabInWorkbenchPanels(createDefaultWorkbenchPanels())
    panels = openTerminalTabInWorkbenchPanels(panels)

    expect(
      reorderTerminalTabInWorkbenchPanels(panels, 'terminal-1', 2).terminalTabs.map(
        (tab) => tab.id,
      ),
    ).toEqual(['terminal-2', 'terminal-3', 'terminal-1'])
    expect(reorderTerminalTabInWorkbenchPanels(panels, 'terminal-1', 0)).toBe(panels)
    expect(reorderTerminalTabInWorkbenchPanels(panels, 'missing', 1)).toBe(panels)
  })

  it('normalizes a stale active terminal id to the first tab', () => {
    const panels = createDefaultWorkbenchPanels()

    expect(
      normalizeWorkbenchPanels({ ...panels, activeTerminalTabId: 'gone' }).activeTerminalTabId,
    ).toBe('terminal-1')
    expect(
      normalizeWorkbenchPanels({
        ...panels,
        activeTerminalTabId: null,
        terminalTabs: [],
      }).activeTerminalTabId,
    ).toBeNull()
  })
})

describe('workbench terminal tab labels', () => {
  it('prefers the rename, then the running command, then the shell title, then the number', () => {
    let panels = createDefaultWorkbenchPanels()
    const label = () => terminalTabLabel(panels.terminalTabs[0]!)

    expect(label()).toBe('Terminal 1')
    panels = setTerminalTabShellTitleInWorkbenchPanels(panels, 'terminal-1', ' ~/platform ')
    expect(label()).toBe('~/platform')
    panels = setTerminalTabProcessInWorkbenchPanels(panels, 'terminal-1', 'nvim')
    expect(label()).toBe('nvim')
    panels = renameTerminalTabInWorkbenchPanels(panels, 'terminal-1', '  build  ')
    expect(label()).toBe('build')
    panels = renameTerminalTabInWorkbenchPanels(panels, 'terminal-1', '')
    expect(label()).toBe('nvim')
    panels = setTerminalTabProcessInWorkbenchPanels(panels, 'terminal-1', null)
    expect(label()).toBe('~/platform')
  })

  it('keeps unchanged and unknown updates referentially stable', () => {
    const panels = createDefaultWorkbenchPanels()

    expect(renameTerminalTabInWorkbenchPanels(panels, 'terminal-1', '   ')).toBe(panels)
    expect(setTerminalTabProcessInWorkbenchPanels(panels, 'terminal-1', null)).toBe(panels)
    expect(renameTerminalTabInWorkbenchPanels(panels, 'missing', 'x')).toBe(panels)
  })
})
