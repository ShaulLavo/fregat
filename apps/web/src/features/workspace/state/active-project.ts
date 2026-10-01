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

// An abandoned activation points at the one it replaced, so a later rollback skips past it.
const abandoned = new WeakMap<ActiveProject, ActiveProject>()

/**
 * Gives up an activation that never landed. While it still holds the project, the project goes
 * back to the last activation before it that was not abandoned. False when a later claim holds it.
 */
export function releaseActiveProject(activation: ActiveProject, previous: ActiveProject) {
  abandoned.set(activation, previous)
  if (useActiveProjectStore.getState() !== activation) return false
  let target = previous
  for (let next = abandoned.get(target); next; next = abandoned.get(target)) target = next
  restoreActiveProject(target)
  return true
}

/** Hands the project back to an earlier activation, which then holds it again. */
export function restoreActiveProject(activation: ActiveProject) {
  useActiveProjectStore.setState(activation, true)
}
