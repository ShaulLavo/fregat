import { createScriptError } from '../../structured-errors'
import { run } from './remote'

export type RepositoryIdentity = {
  /** The first commit on the repository's first-parent history. */
  readonly rootCommit: string
  /** The origin URLs a shallow clone of it may have. */
  readonly origin: RegExp
}

export const FREGAT: RepositoryIdentity = {
  rootCommit: '3d86637e86bdc4cd126cf209e997c2c14b5b56d3',
  origin:
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ShaulLavo\/fregat(?:\.git)?$/,
}

function git(cwd: string, args: readonly string[]) {
  const result = run(['git', '-C', cwd].concat(args))
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}

/**
 * The Fregat checkout that holds `cwd`. The lane force-checks-out whatever this returns, so
 * another repository is refused here, before anything reaches the Pi. A full clone must hold
 * Fregat's root commit; a shallow clone (CI checks out at depth 1) has no root commit to show,
 * so its origin must be Fregat's. Anything else is refused.
 */
export function fregatCheckout(cwd = process.cwd(), identity = FREGAT) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) throw createScriptError(`${cwd} is not inside a git checkout.`)
  if (git(root, ['rev-parse', '--is-shallow-repository']) !== 'true') {
    const roots = git(root, ['rev-list', '--max-parents=0', 'HEAD'])?.split('\n') ?? []
    if (roots.includes(identity.rootCommit)) return root
    throw createScriptError(
      `${root} is not a Fregat checkout (its history lacks ${identity.rootCommit.slice(0, 9)}); the Pi lane only mirrors Fregat.`,
    )
  }
  const origin = git(root, ['remote', 'get-url', 'origin'])
  if (origin && identity.origin.test(origin)) return root
  throw createScriptError(
    `${root} is a shallow clone whose origin (${origin ? withoutCredentials(origin) : 'none'}) is not Fregat's, so it cannot be shown to be Fregat; the Pi lane only mirrors Fregat.`,
  )
}

/** Where a remote URL points, without the userinfo that can carry a token. */
function withoutCredentials(url: string) {
  // scp-style `user@host:path` is not a URL; its user part goes the same way.
  if (!URL.canParse(url)) return url.replace(/^[^@/:]+@/, '')
  const parsed = new URL(url)
  parsed.username = ''
  parsed.password = ''
  return parsed.toString()
}
