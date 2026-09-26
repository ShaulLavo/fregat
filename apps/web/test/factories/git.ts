import { spawnSync } from 'node:child_process'
import type { GitRunOptions, GitRunResult } from 'server/testing'
import { createClientInvariantError } from '@/lib/structured-errors'

/** Synchronous twin of `runGit` in `server/testing`; importing its types only keeps the server graph unloaded. */
export function runGit(
  root: string,
  args: readonly string[],
  options: GitRunOptions = {},
): GitRunResult {
  const inside = options.cwdMode === 'option'
  const result = spawnSync('git', inside ? args : ['-C', root, ...args], {
    cwd: inside ? root : undefined,
    encoding: 'utf8',
  })
  if (result.error)
    throw createClientInvariantError(`git ${args.join(' ')} did not start`, result.error)
  const run = { exitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout }
  if (run.exitCode === 0 || options.allowFailure) return run

  throw createClientInvariantError(
    `git ${args.join(' ')} failed: ${`${run.stderr}${run.stdout}`.trim()}`,
  )
}
