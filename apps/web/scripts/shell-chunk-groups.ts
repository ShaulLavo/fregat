type ChunkingContext = {
  getModuleInfo(id: string): {
    readonly importedIds: readonly string[]
    readonly dynamicallyImportedIds?: readonly string[]
  } | null
}

type ShellRoots = { readonly phone: string; readonly workbench: string }

const GROUPS = ['initial', 'workbench-shared', 'workbench'] as const
type GroupName = (typeof GROUPS)[number]

/**
 * Code-splitting groups for each shell's first load:
 * - `initial`: the entry's static graph, plus the phone shell's static modules the workbench
 *   also needs, since both shells load this chunk;
 * - `workbench-shared`: the rest of the lazy workbench's static graph that a phone can reach;
 * - `workbench`: the rest, which only a desktop ever loads.
 * Whole chunks, because automatic splitting cuts them into dozens of files that gzip worse than
 * one. A group takes its modules' dependencies along, so earlier groups rank higher. `$initial`
 * drops modules an `importedIds` walk reaches through re-exports the bundle never uses (KaTeX).
 */
export function shellChunkGroups(entry: string, shells: ShellRoots) {
  let groups: ReadonlyMap<string, GroupName> | null = null
  return GROUPS.map((group, index) => ({
    name: (id: string, context: ChunkingContext) => {
      groups ??= groupModules(entry, shells, context)
      return groups.get(id) === group ? group : null
    },
    priority: GROUPS.length - index,
    tags: ['$initial' as const],
  }))
}

function groupModules(entry: string, shells: ShellRoots, context: ChunkingContext) {
  const workbench = reachable(shells.workbench, context, { dynamic: false })
  const initial = reachable(entry, context, { dynamic: false })
  for (const id of reachable(shells.phone, context, { dynamic: false }))
    if (workbench.has(id)) initial.add(id)
  // Everything a phone could ever load: every import from the entry except the workbench's.
  const phone = reachable(entry, context, { dynamic: true, skip: shells.workbench })
  const groups = new Map<string, GroupName>()
  for (const id of initial) groups.set(id, 'initial')
  for (const id of workbench) {
    if (initial.has(id)) continue
    groups.set(id, phone.has(id) ? 'workbench-shared' : 'workbench')
  }
  return groups
}

function reachable(
  root: string,
  context: ChunkingContext,
  options: { readonly dynamic: boolean; readonly skip?: string },
) {
  const seen = new Set<string>()
  const pending = [root]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id) || id === options.skip) continue
    seen.add(id)
    const info = context.getModuleInfo(id)
    pending.push(...(info?.importedIds ?? []))
    if (options.dynamic) pending.push(...(info?.dynamicallyImportedIds ?? []))
  }
  return seen
}
