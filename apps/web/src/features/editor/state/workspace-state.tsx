import type { OrchestrationWorktreeShell, WorktreeId } from '@workspace/contracts'
import type { WorktreeIdsByRootPath } from '@/features/workspace/utils/location'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { ChatModePanels } from '@/features/chat-mode/utils/panels'
import type { WorkbenchLayout } from '@/features/workbench/utils/layout'
import type { WorkspaceUiMode } from '@/lib/ui-mode'
import {
  activeEditorContentForWorkbenchPanels,
  editorOpenContentsForWorkbenchPanels,
  normalizeWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { CachedWorkspaceSlice, CachedWorkspaceState } from '@/features/workspace/state/cache'
import { emptyWorkspaceSlice, emptyWorkspaceState } from '@/features/workspace/state/cache'
import { createStoreContext } from '@/lib/store-context'
import { sameTabContent, tabContentKey } from '@/lib/documents/utils/tabs'
import type {
  EditorViewScrollPosition,
  ReopenScrollPosition,
  TabContent,
} from '@/lib/documents/utils/types'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla'

/** What a project remembers while it is not the open one. */
type ParkedWorkspace = CachedWorkspaceSlice & {
  /** Drives both cache ordering and which parked documents survive eviction. */
  readonly lastActiveAt: number
}

type EditorWorkspaceStoreState = CachedWorkspaceSlice & {
  worktreeIdByRootPath: WorktreeIdsByRootPath
  chatModePanels: ChatModePanels
  openTabContents: readonly TabContent[]
  /** Every project except the open one, by root path. */
  parkedWorkspaces: ReadonlyMap<string, ParkedWorkspace>
  pickerOpen: boolean
  rootFolder: PickedFsEntry | null
  selectedTabContent: TabContent | null
  uiMode: WorkspaceUiMode
  workbenchLayout: WorkbenchLayout
}

type EditorWorkspaceStoreActions = {
  bindWorktrees: (worktrees: readonly Pick<OrchestrationWorktreeShell, 'id' | 'path'>[]) => void
  clearRootFolder: () => void
  openPicker: () => void
  setChatModePanels: (panels: ChatModePanels) => void
  setEditorHistory: (contents: readonly TabContent[]) => void
  /** Merges latest scroll positions; positions for closed tabs are kept for reopen. */
  setEditorScrollPositions: (positions: readonly ReopenScrollPosition[]) => void
  setViewScrollPositions: (positions: readonly EditorViewScrollPosition[]) => void
  setPickerOpen: (open: boolean) => void
  setRecentlyClosedTabs: (contents: readonly TabContent[]) => void
  setUiMode: (mode: WorkspaceUiMode) => void
  setWorkbenchLayout: (layout: WorkbenchLayout) => void
  setWorkbenchPanels: (panels: WorkbenchPanels) => void
  /** Parks the open project's tabs and restores the target's. Nothing is discarded. */
  switchWorkspace: (rootFolder: PickedFsEntry | null) => void
}

export type EditorWorkspaceStore = EditorWorkspaceStoreState & EditorWorkspaceStoreActions

export type EditorWorkspaceStoreApi = Mutate<
  StoreApi<EditorWorkspaceStore>,
  [['zustand/subscribeWithSelector', never]]
>

export const {
  Context: EditorWorkspaceStateContext,
  useStoreApi: useEditorWorkspaceStoreApi,
  useSelector: useEditorWorkspaceState,
} = createStoreContext<EditorWorkspaceStoreApi>(
  'useEditorWorkspaceStoreApi must be used within EditorStateProvider',
)

export function createEditorWorkspaceStore(
  initialState: CachedWorkspaceState = emptyWorkspaceState(),
) {
  const activeRootPath = initialState.rootFolder?.path ?? null

  return createStore<EditorWorkspaceStore>()(
    subscribeWithSelector((set, get) => ({
      ...activeWorkspaceState(sliceForRootPath(initialState, activeRootPath)),
      worktreeIdByRootPath: initialState.worktreeIdByRootPath,
      bindWorktrees: (worktrees) => {
        const current = get().worktreeIdByRootPath
        const additions: Record<string, WorktreeId> = {}
        for (const worktree of worktrees) {
          if (current[worktree.path] !== worktree.id) additions[worktree.path] = worktree.id
        }
        if (Object.keys(additions).length > 0)
          set({ worktreeIdByRootPath: { ...current, ...additions } })
      },
      chatModePanels: initialState.chatModePanels,
      parkedWorkspaces: parkedWorkspacesFromCache(initialState, activeRootPath),
      pickerOpen: false,
      rootFolder: initialState.rootFolder,
      uiMode: initialState.uiMode,
      workbenchLayout: initialState.workbenchLayout,
      clearRootFolder: () => set(switchedWorkspaceState(get(), null)),
      openPicker: () => set({ pickerOpen: true }),
      setChatModePanels: (chatModePanels) => set({ chatModePanels }),
      setEditorHistory: (editorHistory) => set({ editorHistory }),
      setEditorScrollPositions: (positions) => {
        const merged = mergedScrollPositions(get().reopenScrollPositions, positions)
        if (!merged) return

        set({ reopenScrollPositions: merged })
      },
      setViewScrollPositions: (viewScrollPositions) => {
        const current = get().viewScrollPositions
        if (
          current.length === viewScrollPositions.length &&
          current.every((entry, index) => {
            const next = viewScrollPositions[index]
            return (
              next?.tabId === entry.tabId &&
              next.position.left === entry.position.left &&
              next.position.top === entry.position.top
            )
          })
        )
          return
        set({ viewScrollPositions })
      },
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
      setRecentlyClosedTabs: (recentlyClosedTabs) => set({ recentlyClosedTabs }),
      setUiMode: (uiMode) => set({ uiMode }),
      setWorkbenchLayout: (workbenchLayout) => set({ workbenchLayout }),
      setWorkbenchPanels: (workbenchPanels) =>
        set((state) =>
          editorWorkspaceSelectionForWorkbenchPanels(workbenchPanels, {
            currentOpenTabContents: state.openTabContents,
          }),
        ),
      switchWorkspace: (rootFolder) => set(switchedWorkspaceState(get(), rootFolder)),
    })),
  )
}

/**
 * Switching is a swap, not a reset: the outgoing project's tabs and history move into
 * `parkedWorkspaces` and the incoming project's come back out. A project the user has
 * never opened restores as an empty slice, which is what a first visit should look like.
 */
function switchedWorkspaceState(
  state: EditorWorkspaceStore,
  rootFolder: PickedFsEntry | null,
): Partial<EditorWorkspaceStore> {
  const nextRootPath = rootFolder?.path ?? null
  const currentRootPath = state.rootFolder?.path ?? null
  if (nextRootPath === currentRootPath) return { pickerOpen: false, rootFolder }

  const parkedWorkspaces = new Map(state.parkedWorkspaces)
  if (currentRootPath !== null) {
    parkedWorkspaces.set(currentRootPath, {
      ...currentWorkspaceSlice(state),
      lastActiveAt: Date.now(),
    })
  }

  const restored = nextRootPath !== null ? parkedWorkspaces.get(nextRootPath) : undefined
  if (nextRootPath !== null) parkedWorkspaces.delete(nextRootPath)

  return {
    ...activeWorkspaceState(restored ?? emptyWorkspaceSlice()),
    parkedWorkspaces,
    pickerOpen: false,
    rootFolder,
  }
}

function currentWorkspaceSlice(state: EditorWorkspaceStore): CachedWorkspaceSlice {
  return {
    editorHistory: state.editorHistory,
    recentlyClosedTabs: state.recentlyClosedTabs,
    reopenScrollPositions: state.reopenScrollPositions,
    viewScrollPositions: state.viewScrollPositions,
    workbenchPanels: state.workbenchPanels,
  }
}

function activeWorkspaceState(slice: CachedWorkspaceSlice) {
  return {
    ...editorWorkspaceSelectionForWorkbenchPanels(slice.workbenchPanels),
    editorHistory: slice.editorHistory,
    recentlyClosedTabs: slice.recentlyClosedTabs,
    reopenScrollPositions: slice.reopenScrollPositions,
    viewScrollPositions: slice.viewScrollPositions,
  }
}

function sliceForRootPath(state: CachedWorkspaceState, rootPath: string | null) {
  if (rootPath === null) return emptyWorkspaceSlice()

  return state.workspaces[rootPath] ?? emptyWorkspaceSlice()
}

/**
 * Restored slices share one timestamp base: the cache records order, not wall-clock
 * recency, so the index position is the only ranking signal that survives a restart.
 */
function parkedWorkspacesFromCache(state: CachedWorkspaceState, activeRootPath: string | null) {
  const parked = new Map<string, ParkedWorkspace>()
  const restoredAt = Date.now()

  state.workspaceOrder.forEach((rootPath, index) => {
    if (rootPath === activeRootPath) return

    const slice = state.workspaces[rootPath]
    if (!slice) return

    parked.set(rootPath, { ...slice, lastActiveAt: restoredAt - index })
  })

  return parked
}

export function editorWorkspaceSelectionForWorkbenchPanels(
  workbenchPanels: WorkbenchPanels,
  options: { currentOpenTabContents?: readonly TabContent[] } = {},
) {
  const normalizedPanels = normalizeWorkbenchPanels(workbenchPanels)
  const openTabContents = stableOpenTabContents(
    options.currentOpenTabContents,
    editorOpenContentsForWorkbenchPanels(normalizedPanels),
  )

  return {
    openTabContents,
    selectedTabContent: activeEditorContentForWorkbenchPanels(normalizedPanels),
    workbenchPanels: normalizedPanels,
  }
}

function stableOpenTabContents(
  current: readonly TabContent[] | undefined,
  next: readonly TabContent[],
) {
  if (!current) return next
  if (!sameOpenTabContents(current, next)) return next

  return current
}

function sameOpenTabContents(left: readonly TabContent[], right: readonly TabContent[]) {
  if (left.length !== right.length) return false

  return left.every((content, index) => sameTabContent(content, right[index]!))
}

/** Returns null when nothing changed, so no-op writes keep the record's identity. */
function mergedScrollPositions(
  current: readonly ReopenScrollPosition[],
  incoming: readonly ReopenScrollPosition[],
): readonly ReopenScrollPosition[] | null {
  let changed = false
  const next = new Map(current.map((entry) => [tabContentKey(entry.content), entry]))
  for (const entry of incoming) {
    const key = tabContentKey(entry.content)
    const existing = next.get(key)
    if (
      existing?.position.left === entry.position.left &&
      existing?.position.top === entry.position.top
    )
      continue
    next.set(key, entry)
    changed = true
  }
  return changed ? Array.from(next.values()) : null
}
