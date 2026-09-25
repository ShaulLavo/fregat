import { isRecord } from '@workspace/utils/objects'
import type { OrchestrationProjectScript } from '@workspace/contracts'

/**
 * The runner a `package.json` script should be invoked through. This repo is a
 * Bun workspace and every other project that ships a manifest still understands
 * `npm run`, but guessing wrong turns a one-click script into a confusing
 * failure — so the lockfile decides, and nothing else.
 */
const RUNNER_BY_LOCKFILE = {
  'bun.lock': 'bun run',
  'bun.lockb': 'bun run',
  'package-lock.json': 'npm run',
  'pnpm-lock.yaml': 'pnpm run',
  'yarn.lock': 'yarn',
} as const

export type ProjectScriptSuggestion = OrchestrationProjectScript & {
  /** True once the project already saved a script with this command. */
  readonly saved: boolean
  /** Where an unsaved suggestion was read from. */
  readonly origin: 'saved' | 'package.json' | 't3.json'
}

export function packageScriptRunner(lockfileNames: readonly string[]) {
  for (const [lockfile, runner] of Object.entries(RUNNER_BY_LOCKFILE)) {
    if (lockfileNames.includes(lockfile)) return runner
  }

  return 'npm run'
}

/**
 * Reads a `package.json`'s `scripts` into runnable commands.
 *
 * Tolerant on purpose: a manifest that fails to parse, has no scripts, or has a
 * non-string value in the map yields fewer suggestions rather than an error. A
 * broken manifest is the user's problem to see in their editor, not a reason for
 * the palette to refuse to open.
 */
export function packageJsonScripts(
  contents: string,
  runner: string,
): readonly OrchestrationProjectScript[] {
  const scripts = parseScriptMap(contents)
  if (!scripts) return []

  return Object.keys(scripts)
    .filter((name) => name.trim().length > 0)
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({ command: `${runner} ${name}`, name }))
}

/**
 * Saved scripts first, in the order the project holds them, then whatever `t3.json`
 * and the manifest offer that is not already saved. Deduplicated by command rather than
 * by name: two entries that run the same thing are one row however they are
 * labelled, and the saved label is the one the user chose.
 */
export function projectScriptSuggestions({
  discovered,
  projectFile = [],
  saved,
}: {
  readonly discovered: readonly OrchestrationProjectScript[]
  readonly projectFile?: readonly OrchestrationProjectScript[]
  readonly saved: readonly OrchestrationProjectScript[]
}): readonly ProjectScriptSuggestion[] {
  const savedCommands = new Set(saved.map((script) => script.command))
  const unsaved = (
    scripts: readonly OrchestrationProjectScript[],
    origin: ProjectScriptSuggestion['origin'],
  ) =>
    scripts
      .filter((script) => !savedCommands.has(script.command))
      .map((script) => ({ ...script, saved: false, origin }))

  return [
    ...saved.map((script) => ({ ...script, saved: true, origin: 'saved' as const })),
    ...unsaved(importableScripts(projectFile, saved), 't3.json'),
    ...unsaved(discovered, 'package.json'),
  ]
}

/**
 * Scripts a `t3.json` project file declares, mapped the way upstream's Import scripts maps them:
 * `async` defaults to true, and only a worktree-creation script with `async: false` holds the
 * first turn. Tolerant like `packageJsonScripts`: an unreadable file offers nothing.
 */
export function t3ProjectScripts(contents: string): readonly OrchestrationProjectScript[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return []
  }
  const scripts = isRecord(parsed) && Array.isArray(parsed.scripts) ? parsed.scripts : []
  return scripts.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return []
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!name || !command) return []
    const runOnWorktreeCreate = entry.runOnWorktreeCreate === true
    return [
      {
        name,
        command,
        ...(runOnWorktreeCreate ? { runOnWorktreeCreate } : {}),
        ...(runOnWorktreeCreate && entry.async === false ? { waitForSetup: true } : {}),
      },
    ]
  })
}

/** File scripts the project has not saved yet, by command or by name, ignoring case. */
export function importableScripts(
  file: readonly OrchestrationProjectScript[],
  saved: readonly OrchestrationProjectScript[],
) {
  const commands = new Set(saved.map((script) => script.command))
  const names = new Set(saved.map((script) => script.name.toLowerCase()))
  return file.filter(
    (script) => !commands.has(script.command) && !names.has(script.name.toLowerCase()),
  )
}

function parseScriptMap(contents: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(contents)
    if (!parsed || typeof parsed !== 'object') return null

    const scripts = (parsed as { scripts?: unknown }).scripts
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return null

    return scripts as Record<string, unknown>
  } catch {
    return null
  }
}
