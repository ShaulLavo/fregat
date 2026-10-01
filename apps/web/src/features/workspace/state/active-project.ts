import { create } from 'zustand'

/**
 * Which project the app is pointed at, by workspace root.
 *
 * Chat and the editor move at different speeds: picking a session should show that
 * conversation on the next frame, while opening its folder in the editor has to stat
 * the path first. Both read this store, so they agree on the destination even while
 * the editor is still catching up — and a slow earlier open can tell it lost by
 * checking whether its own root is still the active one.
 *
 * Null means "wherever the editor is": on a cold start nothing has been activated yet.
 */
type ActiveProject = { readonly workspaceRoot: string | null }

export const useActiveProjectStore = create<ActiveProject>()(() => ({ workspaceRoot: null }))

/** Each activation is a new state object, so a holder can tell a later claim on the same root from its own. */
export function activateWorkspaceRoot(workspaceRoot: string | null): ActiveProject {
  useActiveProjectStore.setState({ workspaceRoot }, true)
  return useActiveProjectStore.getState()
}

/** False once a later activation has superseded this one. */
export function isActiveWorkspaceRoot(workspaceRoot: string) {
  return useActiveProjectStore.getState().workspaceRoot === workspaceRoot
}

export function holdsActiveProject(activation: ActiveProject) {
  return useActiveProjectStore.getState() === activation
}

/** Hands the project back to an earlier activation, which then holds it again. */
export function restoreActiveProject(activation: ActiveProject) {
  useActiveProjectStore.setState(activation, true)
}
