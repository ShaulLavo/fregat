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
 * Saved scripts first, in the order the project holds them, then whatever the
 * manifest offers that is not already saved. Deduplicated by command rather than
 * by name: two entries that run the same thing are one row however they are
 * labelled, and the saved label is the one the user chose.
 */
export function projectScriptSuggestions({
  discovered,
  saved,
}: {
  readonly discovered: readonly OrchestrationProjectScript[]
  readonly saved: readonly OrchestrationProjectScript[]
}): readonly ProjectScriptSuggestion[] {
  const savedCommands = new Set(saved.map((script) => script.command))

  return [
    ...saved.map((script) => ({ ...script, saved: true })),
    ...discovered
      .filter((script) => !savedCommands.has(script.command))
      .map((script) => ({ ...script, saved: false })),
  ]
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
