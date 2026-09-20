import type { HistoryNodeId, EditorResolvedSelection } from '@singapore-editor/core'
import {
  createDiffRegionStore,
  type DiffFile,
  type DiffGutterSide,
  type DiffRegionStore,
} from '@singapore-editor/diff'
import type { TabId } from '@/lib/documents/utils/types'
import type { DiffScrollPosition } from '@/features/editor/utils/diff-scroll-bridge'

export type DiffPanePresentation = {
  scroll: DiffScrollPosition | null
  selections: readonly EditorResolvedSelection[]
}

export type HistoryPresentation = {
  focusedId: HistoryNodeId | null
  selectedIds: readonly HistoryNodeId[]
  barrierFocused: boolean
}

export class TabPresentation {
  readonly regions: DiffRegionStore = createDiffRegionStore()
  readonly diffPanes: Readonly<Record<DiffGutterSide, DiffPanePresentation>> = {
    old: { scroll: null, selections: [] },
    new: { scroll: null, selections: [] },
    stacked: { scroll: null, selections: [] },
  }
  readonly history: HistoryPresentation = {
    focusedId: null,
    selectedIds: [],
    barrierFocused: false,
  }
  diffLayout: Record<string, number> | undefined
  diffFile: DiffFile | null = null

  setDiffFile(file: DiffFile | null): void {
    this.diffFile = file
  }

  setDiffLayout(layout: Record<string, number>): void {
    this.diffLayout = layout
  }

  setBarrierFocused(focused: boolean): void {
    this.history.barrierFocused = focused
  }
}

export function createTabPresentation(): TabPresentation {
  return new TabPresentation()
}

export class TabPresentations {
  private readonly tabs = new Map<TabId, TabPresentation>()

  get(tabId: TabId): TabPresentation {
    const existing = this.tabs.get(tabId)
    if (existing) return existing
    const presentation = createTabPresentation()
    this.tabs.set(tabId, presentation)
    return presentation
  }

  retain(tabIds: ReadonlySet<TabId>): void {
    for (const tabId of this.tabs.keys()) {
      if (!tabIds.has(tabId)) this.tabs.delete(tabId)
    }
  }

  copy(fromTabId: TabId, toTabId: TabId): void {
    const source = this.tabs.get(fromTabId)
    if (!source || fromTabId === toTabId) return
    const target = createTabPresentation()
    target.diffFile = source.diffFile
    target.diffLayout = source.diffLayout
    target.regions.setFile(source.diffFile)
    for (const key of source.regions.getExpandedRegions()) target.regions.toggleRegion(key)
    for (const side of ['old', 'new', 'stacked'] as const) {
      Object.assign(target.diffPanes[side], source.diffPanes[side])
    }
    Object.assign(target.history, source.history)
    this.tabs.set(toTabId, target)
  }
}
