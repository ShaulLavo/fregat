import { create } from 'zustand'

/**
 * Which project the app is pointed at, by workspace root.
 *
 * Chat and the editor move at different speeds: picking a session should show that
 * conversation on the next frame, while opening its folder in the editor has to stat
 * the path first. Both read this store, so they agree on the destination even while
 * the editor is still catching up — and a slow earlier open can tell it lost by
 * checking whether it still holds its own activation.
 *
 * Null means "wherever the editor is": on a cold start nothing has been activated yet.
 */
type ActiveProject = {
  readonly workspaceRoot: string | null
  /** Set when the open behind this activation gives up: the activation it replaced. */
  abandonedFor?: ActiveProject
}

export const useActiveProjectStore = create<ActiveProject>()(() => ({ workspaceRoot: null }))

/** Each activation is a new state object, so a holder can tell a later claim on the same root from its own. */
export function activateWorkspaceRoot(workspaceRoot: string | null): ActiveProject {
  useActiveProjectStore.setState({ workspaceRoot }, true)
  return useActiveProjectStore.getState()
}

/** False once a later activation, even of the same root, has superseded this one. */
export function holdsActiveProject(activation: ActiveProject) {
  return useActiveProjectStore.getState() === activation
}

/**
 * Gives up an activation that never landed. While it still holds the project, the project goes
 * back to the last activation before it that was not abandoned. False when a later claim holds it.
 */
export function releaseActiveProject(activation: ActiveProject, previous: ActiveProject) {
  activation.abandonedFor = previous
  if (!holdsActiveProject(activation)) return false
  let target = previous
  while (target.abandonedFor) target = target.abandonedFor
  restoreActiveProject(target)
  return true
}

/** Hands the project back to an earlier activation, which then holds it again. */
export function restoreActiveProject(activation: ActiveProject) {
  useActiveProjectStore.setState(activation, true)
}
