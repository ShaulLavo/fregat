import { createScriptError } from '../../structured-errors'
import { run } from './remote'

// The first commit on Platform's first-parent history; every Fregat checkout and worktree has it.
const FREGAT_ROOT_COMMIT = '3d86637e86bdc4cd126cf209e997c2c14b5b56d3'

function git(cwd: string, args: readonly string[]) {
  const result = run(['git', '-C', cwd, ...args])
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}

/**
 * The Fregat checkout that holds `cwd`. The lane force-checks-out whatever this returns, so
 * another repository is refused here, before anything reaches the Pi.
 */
export function fregatCheckout(cwd = process.cwd()) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) throw createScriptError(`${cwd} is not inside a git checkout.`)
  const roots = git(root, ['rev-list', '--max-parents=0', 'HEAD'])?.split('\n') ?? []
  if (!roots.includes(FREGAT_ROOT_COMMIT)) {
    throw createScriptError(
      `${root} is not a Fregat checkout (its history lacks ${FREGAT_ROOT_COMMIT.slice(0, 9)}); the Pi lane only mirrors Fregat.`,
    )
  }
  return root
}
