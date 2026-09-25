import path from 'node:path'
import type { WorktreeSubmoduleMode } from '@workspace/contracts'
import type { SettingsStore } from '../settings/store'
import { maybeStat } from './utils/worktree-paths'

type Run = (
  args: readonly string[],
  options?: { allowFailure?: boolean },
) => Promise<{ exitCode: number; stdout: string }>

export const DECLARED_SUBMODULE_PATHS_ARGS = [
  'config',
  '--file',
  '.gitmodules',
  '--null',
  '--get-regexp',
  '^submodule\\..*\\.path$',
] as const

/** A recursive clone of large submodules is legitimately slow; a credential prompt would hang forever. */
export const SUBMODULE_UPDATE_OPTIONS = {
  env: { GIT_TERMINAL_PROMPT: '0' },
  timeoutMs: 15 * 60_000,
} as const

export function submoduleUpdateArgs(mode: Exclude<WorktreeSubmoduleMode, 'none'>) {
  return mode === 'recursive'
    ? ['submodule', 'update', '--init', '--recursive']
    : ['submodule', 'update', '--init']
}

export async function hasSubmodules(root: string) {
  return (await maybeStat(path.join(root, '.gitmodules'))) !== null
}

/** Declared submodules whose checkout has no `.git` entry: `worktree add` leaves every one empty. */
export async function uninitializedSubmoduleCount(root: string, run: Run) {
  if (!(await hasSubmodules(root))) return 0
  const result = await run(DECLARED_SUBMODULE_PATHS_ARGS, { allowFailure: true })
  if (result.exitCode !== 0) return 0
  const paths = declaredSubmodulePaths(result.stdout)
  const present = await Promise.all(
    paths.map(
      async (entry) => (await maybeStat(path.join(root, entry, '.git')).catch(() => null)) !== null,
    ),
  )
  return present.filter((exists) => !exists).length
}

/** `--null` output: `key\nvalue\0` per entry. */
export function declaredSubmodulePaths(output: string) {
  return output
    .split('\0')
    .map((entry) => entry.slice(entry.indexOf('\n') + 1))
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
}

/** The project override wins over the machine default. */
export function worktreeSubmoduleMode(
  settings: Pick<SettingsStore, 'snapshot'>,
  projectId: string | null,
): WorktreeSubmoduleMode {
  const values = settings.snapshot().values
  return (
    (projectId ? values['git.projectWorktreeSubmodules'][projectId] : undefined) ??
    values['git.worktreeSubmodules']
  )
}
