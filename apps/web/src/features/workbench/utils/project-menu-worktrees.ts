import type { ProjectMenuEntry } from '@/features/workbench/utils/project-menu-model'
import { basename } from '@/lib/path-formatters'

export type ProjectMenuCheckout = {
  readonly branch: string | null
  readonly main: boolean
  /** Workspace-relative, or null when the checkout sits outside the workspace. */
  readonly path: string | null
}

type Group = { head: ProjectMenuEntry | null; readonly worktrees: ProjectMenuEntry[] }

/**
 * Puts each linked worktree under its repository's own checkout. Groups keep the
 * recency of their first member, and a checkout that is not itself recent is added
 * so its worktrees still have a parent to sit under.
 */
export function nestWorktrees(
  entries: readonly ProjectMenuEntry[],
  checkoutsByRoot: ReadonlyMap<string, readonly ProjectMenuCheckout[]>,
): readonly ProjectMenuEntry[] {
  const groups = new Map<string, Group>()
  for (const entry of entries) {
    const parent = mainCheckout(entry.rootPath, checkoutsByRoot.get(entry.rootPath))
    const group = groupFor(groups, parent?.mainPath ?? entry.rootPath)
    if (!parent) {
      group.head = entry
      continue
    }

    group.worktrees.push({ ...entry, worktree: { branch: parent.branch } })
  }

  return [...groups].flatMap(([rootPath, group]) => [
    group.head ?? { qualifier: null, rootPath, title: basename(rootPath) },
    ...group.worktrees,
  ])
}

function groupFor(groups: Map<string, Group>, rootPath: string) {
  const existing = groups.get(rootPath)
  if (existing) return existing

  const created: Group = { head: null, worktrees: [] }
  groups.set(rootPath, created)
  return created
}

function mainCheckout(rootPath: string, checkouts: readonly ProjectMenuCheckout[] | undefined) {
  const own = checkouts?.find((checkout) => checkout.path === rootPath)
  const mainPath = checkouts?.find((checkout) => checkout.main)?.path
  if (!own || own.main || !mainPath) return null

  return { branch: own.branch, mainPath }
}
