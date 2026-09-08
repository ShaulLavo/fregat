import type { OrchestrationWorktreeShell, WorktreeId } from '@workspace/contracts'
import type { WorktreeIdsByRootPath } from '@/features/workspace/utils/location'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { ChatModePanels } from '@/features/chat-mode/utils/panels'
import type { WorkbenchLayout } from '@/features/workbench/utils/layout'
import type { WorkspaceUiMode } from '@/lib/ui-mode'
import {
  activeEditorPathForWorkbenchPanels,
  editorOpenPathsForWorkbenchPanels,
  normalizeWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { CachedWorkspaceSlice, CachedWorkspaceState } from '@/features/workspace/state/cache'
import { emptyWorkspaceSlice, emptyWorkspaceState } from '@/features/workspace/state/cache'
import { clientErrors } from '@/lib/structured-errors'
import type { EditorScrollPosition } from '@singapor/core'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
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
  openFilePaths: string[]
  /** Every project except the open one, by root path. */
  parkedWorkspaces: ReadonlyMap<string, ParkedWorkspace>
  pickerOpen: boolean
  rootFolder: PickedFsEntry | null
  selectedFilePath: string | null
  uiMode: WorkspaceUiMode
  workbenchLayout: WorkbenchLayout
}

type EditorWorkspaceStoreActions = {
  bindWorktrees: (worktrees: readonly Pick<OrchestrationWorktreeShell, 'id' | 'path'>[]) => void
  clearRootFolder: () => void
  openPicker: () => void
  setChatModePanels: (panels: ChatModePanels) => void
  setEditorHistory: (paths: string[]) => void
  /** Merges latest scroll positions; positions for closed tabs are kept for reopen. */
  setEditorScrollPositions: (byPath: Record<string, EditorScrollPosition>) => void
  setPickerOpen: (open: boolean) => void
  setRecentlyClosedEditorPaths: (paths: string[]) => void
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

export const EditorWorkspaceStateContext = createContext<EditorWorkspaceStoreApi | null>(null)

export function useEditorWorkspaceStoreApi() {
  const store = use(EditorWorkspaceStateContext)
  if (!store) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useEditorWorkspaceStoreApi must be used within EditorStateProvider',
    })
  }

  return store
}

export function useEditorWorkspaceState<T>(selector: (state: EditorWorkspaceStore) => T): T {
  return useStore(useEditorWorkspaceStoreApi(), selector)
}

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
      setEditorScrollPositions: (byPath) => {
        const merged = mergedScrollPositions(get().scrollPositionByPath, byPath)
        if (!merged) return

        set({ scrollPositionByPath: merged })
      },
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
      setRecentlyClosedEditorPaths: (recentlyClosedEditorPaths) =>
        set({ recentlyClosedEditorPaths }),
      setUiMode: (uiMode) => set({ uiMode }),
      setWorkbenchLayout: (workbenchLayout) => set({ workbenchLayout }),
      setWorkbenchPanels: (workbenchPanels) =>
        set((state) =>
          editorWorkspaceSelectionForWorkbenchPanels(workbenchPanels, {
            currentOpenFilePaths: state.openFilePaths,
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
  if (currentRootPath) {
    parkedWorkspaces.set(currentRootPath, {
      ...currentWorkspaceSlice(state),
      lastActiveAt: Date.now(),
    })
  }

  const restored = nextRootPath ? parkedWorkspaces.get(nextRootPath) : undefined
  if (nextRootPath) parkedWorkspaces.delete(nextRootPath)

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
    recentlyClosedEditorPaths: state.recentlyClosedEditorPaths,
    scrollPositionByPath: state.scrollPositionByPath,
    workbenchPanels: state.workbenchPanels,
  }
}

function activeWorkspaceState(slice: CachedWorkspaceSlice) {
  return {
    ...editorWorkspaceSelectionForWorkbenchPanels(slice.workbenchPanels),
    editorHistory: slice.editorHistory,
    recentlyClosedEditorPaths: slice.recentlyClosedEditorPaths,
    scrollPositionByPath: slice.scrollPositionByPath,
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
  options: { currentOpenFilePaths?: string[] } = {},
) {
  const normalizedPanels = normalizeWorkbenchPanels(workbenchPanels)
  const openFilePaths = stableOpenFilePaths(
    options.currentOpenFilePaths,
    editorOpenPathsForWorkbenchPanels(normalizedPanels),
  )

  return {
    openFilePaths,
    selectedFilePath: activeEditorPathForWorkbenchPanels(normalizedPanels),
    workbenchPanels: normalizedPanels,
  }
}

function stableOpenFilePaths(current: string[] | undefined, next: string[]) {
  if (!current) return next
  if (!sameOpenFilePaths(current, next)) return next

  return current
}

function sameOpenFilePaths(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false

  return left.every((path, index) => path === right[index])
}

/** Returns null when nothing changed, so no-op writes keep the record's identity. */
function mergedScrollPositions(
  current: Readonly<Record<string, EditorScrollPosition>>,
  incoming: Readonly<Record<string, EditorScrollPosition>>,
): Record<string, EditorScrollPosition> | null {
  let changed = false
  const next: Record<string, EditorScrollPosition> = { ...current }
  for (const [path, position] of Object.entries(incoming)) {
    const existing = next[path]
    if (existing && existing.left === position.left && existing.top === position.top) continue

    next[path] = { left: position.left, top: position.top }
    changed = true
  }

  return changed ? next : null
}
