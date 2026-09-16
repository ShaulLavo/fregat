import { projectQualifiers } from '@/features/chat/utils/project-qualifiers'

export type ProjectMenuEntry = {
  /** Parent-path hint, set only when another entry shares this title. */
  readonly qualifier: string | null
  readonly rootPath: string
  readonly title: string
}

/**
 * What the project menu offers, most recent first. Two sources, because neither
 * alone is complete: the file server's recents cover folders opened as a
 * workspace root, and the orchestration projects cover ones that only ever
 * existed as a chat project, which was never opened here and so has no
 * last-opened stamp of its own.
 *
 * Order is load-bearing and comes from each source, since they have no shared
 * clock: recents arrive last-opened first, and projects arrive oldest-first from
 * the shell snapshot, so they are reversed onto the tail. Never-opened trails
 * ever-opened, which is the honest reading of "recent" for a menu that swaps the
 * workspace root.
 *
 * The open root is always first so the menu can never contradict the title
 * sitting next to it, even before either source has loaded.
 */
export function projectMenuModel({
  activeRootPath,
  activeTitle,
  projects,
  recentFolders,
}: {
  readonly activeRootPath: string | null
  readonly activeTitle: string
  readonly projects: readonly {
    readonly title: string
    readonly updatedAt: string
    readonly workspaceRoot: string
  }[]
  readonly recentFolders: readonly { readonly name: string; readonly path: string }[]
}): readonly ProjectMenuEntry[] {
  const byRootPath = new Map<string, string>()
  if (activeRootPath) byRootPath.set(activeRootPath, activeTitle)
  for (const folder of recentFolders) {
    if (byRootPath.has(folder.path)) continue

    byRootPath.set(folder.path, folder.name)
  }
  for (const project of activityFirst(projects)) {
    if (byRootPath.has(project.workspaceRoot)) continue

    byRootPath.set(project.workspaceRoot, project.title)
  }

  const entries = [...byRootPath].map(([rootPath, title]) => ({
    id: rootPath,
    title,
    workspaceRoot: rootPath,
  }))
  const qualifiers = projectQualifiers(entries)

  return entries.map((entry) => ({
    qualifier: qualifiers.get(entry.id) ?? null,
    rootPath: entry.workspaceRoot,
    title: entry.title,
  }))
}

/** The shell snapshot is ordered oldest-first, which is backwards for a recents menu. */
function activityFirst<TProject extends { readonly updatedAt: string }>(
  projects: readonly TProject[],
) {
  // Parsed rather than compared as text: the stamps may carry a UTC offset,
  // and those do not sort lexicographically.
  return projects.toSorted(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}
