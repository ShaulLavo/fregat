/**
 * Verbs that cannot change what `git status` reports. `hash-object -w` is in
 * here because it only adds a loose object; the index and the worktree are
 * untouched. Everything absent from this set invalidates.
 */
const READ_ONLY_GIT_ACTIONS = new Set([
  'cat-file',
  'check-ref-format',
  'merge-base',
  'diff',
  'diff-tree',
  'for-each-ref',
  'hash-object',
  'log',
  'ls-files',
  'rev-parse',
  'show',
  'status',
])

export function gitAction(args: readonly string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument) continue
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) return argument
  }
  return 'unknown'
}

export function isReadOnlyGit(args: readonly string[]) {
  const action = gitAction(args)
  if (READ_ONLY_GIT_ACTIONS.has(action)) return true
  if (action === 'apply' && args.includes('--check')) return true
  const actionIndex = args.indexOf(action)
  if (action === 'config') return args.includes('--get-regexp') || args.includes('--get')
  if (action === 'symbolic-ref')
    return (
      args.length === actionIndex + 3 &&
      args[actionIndex + 1] === '--quiet' &&
      !args[actionIndex + 2]?.startsWith('-')
    )
  // Listing remotes reads config; `remote add` and friends write it.
  if (action === 'remote') return [undefined, '-v', 'get-url'].includes(args[actionIndex + 1])
  return action === 'worktree' && args[actionIndex + 1] === 'list'
}
