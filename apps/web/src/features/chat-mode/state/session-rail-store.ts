import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type { EnvironmentId, ScopedSessionRef } from '@workspace/contracts'
import { create } from 'zustand'

import {
  readPersistedRailCollapse,
  writePersistedRailCollapse,
} from '@/features/chat-mode/utils/rail-collapse-storage'
import type { SessionRailScope, SessionRailView } from '@workspace/client-core/chat/rail/model'

/** Rename happens in two places, and only the one that was asked may swap for a field. */
export type SessionRenameSurface = 'header' | 'rail'

type SessionRenameTarget = {
  readonly surface: SessionRenameSurface
  readonly ref: ScopedSessionRef
}

const NO_PROJECT_IDS: readonly string[] = []

/**
 * How the session list is currently being looked at: which projects, which text, the
 * inbox or the archive, which projects are folded shut, and which row has swapped its
 * title for a rename field.
 *
 * A store rather than rail-local state because the keyboard commands act on exactly
 * the list the user can see, and they run from the app keymap — several layers above
 * chat mode, with no React context of the rail's to read.
 */
type SessionRailStore = {
  readonly collapsedProjectIds: readonly string[]
  readonly query: string
  readonly renaming: SessionRenameTarget | null
  readonly scope: SessionRailScope
  readonly machineFilter: EnvironmentId | null
  readonly view: SessionRailView
  readonly endRename: () => void
  readonly setQuery: (query: string) => void
  readonly setScope: (scope: SessionRailScope) => void
  readonly setMachineFilter: (machineFilter: EnvironmentId | null) => void
  readonly setView: (view: SessionRailView) => void
  readonly startRename: (target: SessionRenameTarget) => void
  readonly toggleProjectCollapsed: (projectKeys: readonly string[]) => void
}

const collapseStorage = new Map<EnvironmentId, ScopedStorage>()

export function hydrateSessionRailCollapse(storage: ScopedStorage) {
  collapseStorage.set(storage.environmentId, storage)
  const restored = readPersistedRailCollapse(storage)
  useSessionRailStore.setState((state) => ({
    collapsedProjectIds: [...new Set([...state.collapsedProjectIds, ...restored])],
  }))
}

function persistRailCollapse(collapsedProjectIds: readonly string[]) {
  const slices = useChatProjectionStore.getState().slices
  for (const storage of collapseStorage.values()) {
    const projects = slices[storage.environmentId]?.projectById ?? {}
    writePersistedRailCollapse(
      storage,
      collapsedProjectIds.filter((key) =>
        Object.keys(projects).some((id) => key === `${storage.environmentId}:${id}`),
      ),
    )
  }
}

export const useSessionRailStore = create<SessionRailStore>()((set) => ({
  // Persisted, unlike everything else here: a collapse is a lasting statement
  // about a project the user is not working in, and re-expanding every group on
  // reload undoes the tidying they did on purpose. Scope, view and search text
  // stay in memory — those describe a moment, not a preference.
  collapsedProjectIds: NO_PROJECT_IDS,
  endRename: () => set({ renaming: null }),
  query: '',
  renaming: null,
  scope: null,
  machineFilter: null,
  setQuery: (query) => set({ query }),
  setScope: (scope) => set({ scope }),
  setMachineFilter: (machineFilter) => set({ machineFilter }),
  setView: (view) => set({ view }),
  startRename: (renaming) => set({ renaming }),
  toggleProjectCollapsed: (projectKeys) =>
    set((state) => {
      const collapsedProjectIds = toggledProjectIds(state.collapsedProjectIds, projectKeys)
      // Written on the click rather than debounced: a collapse is one rare
      // deliberate act, not a keystroke stream, and a reload right after it is
      // exactly when the user notices it did not stick.
      persistRailCollapse(collapsedProjectIds)

      return { collapsedProjectIds }
    }),
  view: 'active',
}))

function toggledProjectIds(projectIds: readonly string[], projectKeys: readonly string[]) {
  if (projectKeys.every((key) => projectIds.includes(key)))
    return projectIds.filter((candidate) => !projectKeys.includes(candidate))
  return [...new Set([...projectIds, ...projectKeys])]
}
