import { createInternalError } from '../observability/structured-errors'

export type GitRunOptions = {
  readonly allowFailure?: boolean
  /** `option` spawns inside `root`; `flag` passes `-C root`, which resolves a symlinked temp root. */
  readonly cwdMode?: 'flag' | 'option'
}

export type GitRunResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export async function runGit(
  root: string,
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<GitRunResult> {
  const inside = options.cwdMode === 'option'
  const command = inside ? ['git', ...args] : ['git', '-C', root, ...args]
  const child = Bun.spawn(command, {
    cwd: inside ? root : undefined,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0 || options.allowFailure) return { exitCode, stderr, stdout }

  throw createInternalError(`git ${args.join(' ')} failed: ${`${stderr}${stdout}`.trim()}`)
}
