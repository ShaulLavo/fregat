import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createScriptError } from '../../structured-errors'
import { run } from './remote'

const SECRET_LIKE = [/(^|\/)\.env/i, /\.pem$/i, /key/i, /credential/i]

export type ShipPlan = {
  readonly diff: Uint8Array
  readonly includes: readonly string[]
  readonly omitted: readonly string[]
  readonly bytes: number
}

function git(root: string, args: readonly string[]) {
  return run(['git', '-C', root].concat(args))
}

function refuseInclude(root: string, file: string) {
  if (file.startsWith('..') || path.isAbsolute(file)) return 'is outside the checkout'
  if (SECRET_LIKE.some((pattern) => pattern.test(file))) return 'looks like a secret'
  const absolute = path.join(root, file)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return 'is not a file'
  if (git(root, ['check-ignore', '-q', '--', file]).exitCode === 0) return 'is gitignored'
  if (git(root, ['ls-files', '--error-unmatch', '--', file]).exitCode === 0) {
    return 'is tracked, so it already ships through the diff'
  }
  return null
}

/**
 * What a sync sends: the tracked changes against HEAD, plus untracked files only when named.
 * Untracked files nobody named stay here and are listed, so the Pi's provenance shows the gap.
 */
export function shipPlan(
  root: string,
  named: readonly string[],
  maxBytes: number,
  cwd = process.cwd(),
): ShipPlan {
  const includes = named.map((name) => path.relative(root, path.resolve(cwd, name)))
  for (const file of includes) {
    const reason = refuseInclude(root, file)
    if (reason) throw createScriptError(`--include ${file} ${reason}; it was not sent.`)
  }
  const diff = git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']).stdout
  const bytes = includes.reduce(
    (sum, file) => sum + statSync(path.join(root, file)).size,
    diff.byteLength,
  )
  if (bytes > maxBytes) {
    throw createScriptError(
      `The sync would send ${bytes} bytes of changes and includes, over the ${maxBytes}-byte cap (--max-transfer-mib).`,
    )
  }
  const untracked = git(root, [
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
  ]).stdout.toString()
  const omitted = untracked.split('\0').filter((file) => file && !includes.includes(file))
  return { diff, includes, omitted, bytes }
}
