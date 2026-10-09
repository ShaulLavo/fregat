import { createScriptError } from '../../../scripts/structured-errors.ts'

type ChunkingContext = {
  getModuleInfo(id: string): {
    readonly importedIds: readonly string[]
    readonly dynamicallyImportedIds?: readonly string[]
  } | null
}

type ShellRoots = {
  readonly phone: string
  readonly workbench: string
  readonly phoneScreens: readonly string[]
  /** Closed dialogs and drawers a phone loads after its first screen. */
  readonly phoneOverlays: readonly string[]
}

const GROUPS = [
  'initial',
  'phone-sessions',
  'phone-session',
  'phone-overlays',
  'workbench-shared',
  'workbench',
] as const
type GroupName = (typeof GROUPS)[number]

/**
 * Code-splitting groups for each shell's first load:
 * - `initial`: the entry's static graph, plus the phone shell and boot screens' static modules the workbench
 *   also needs, since both shells load this chunk;
 * - `phone-overlays`: the workbench modules the phone's deferred overlays need, so opening one on
 *   a phone downloads them alone, never `workbench-shared` or a boot screen's chunk;
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
  const screens = shells.phoneScreens.map((root) => reachable(root, context, { dynamic: false }))
  for (const id of reachable(shells.phone, context, { dynamic: false }))
    if (workbench.has(id)) initial.add(id)
  for (const id of screens[0] ?? [])
    if (workbench.has(id) && screens.every((screen) => screen.has(id))) initial.add(id)
  const overlays = new Set(
    shells.phoneOverlays.flatMap((root) => Array.from(overlayModules(root, context))),
  )
  // Shared by an overlay and a boot screen: the overlay must not pull the screen's whole chunk.
  for (const id of overlays)
    if (workbench.has(id) && screens.some((screen) => screen.has(id))) initial.add(id)
  // Everything a phone could ever load: every import from the entry except the workbench's.
  const phone = reachable(entry, context, { dynamic: true, skip: shells.workbench })
  const groups = new Map<string, GroupName>()
  for (const id of initial) groups.set(id, 'initial')
  for (const id of workbench) {
    if (initial.has(id)) continue
    const screen = screens.findIndex((modules) => modules.has(id))
    if (screen !== -1) {
      groups.set(id, screen === 0 ? 'phone-sessions' : 'phone-session')
      continue
    }
    if (overlays.has(id)) {
      groups.set(id, 'phone-overlays')
      continue
    }
    groups.set(id, phone.has(id) ? 'workbench-shared' : 'workbench')
  }
  return groups
}

function overlayModules(root: string, context: ChunkingContext) {
  if (!context.getModuleInfo(root)) throw createScriptError(`shell-chunks: no module for ${root}`)
  return reachable(root, context, { dynamic: false })
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
