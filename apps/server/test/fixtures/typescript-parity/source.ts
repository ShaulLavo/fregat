import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
  encoding: 'utf8',
}).trim()

const SOURCE_PATHS = [
  'bun.lock',
  'package.json',
  'apps/server/src/lsp',
  'apps/server/test/factories/typescript-runtime.ts',
  'apps/server/test/factories/typescript-parity.ts',
  'apps/server/test/fixtures/typescript-parity',
  'scripts/typescript-parity.mjs',
  'scripts/typescript-parity.test.mjs',
  'scripts/typescript-parity-capture.mjs',
]

export function paritySourceIdentity(root = workspaceRoot) {
  const revision = git(['rev-parse', 'HEAD'], root)
  const dirty = git(['status', '--porcelain'], root).length > 0
  const files = git(
    ['ls-files', '--cached', '--others', '--exclude-standard', '--'].concat(SOURCE_PATHS),
    root,
  )
    .split('\n')
    .filter(Boolean)
  files.sort()
  const hash = createHash('sha256')
  for (const path of files) {
    hash.update(`${path}\0`)
    const absolute = resolve(root, path)
    const present = existsSync(absolute)
    hash.update(present ? 'present\0' : 'deleted\0')
    if (present) hash.update(readFileSync(absolute))
    hash.update('\0')
  }
  return { revision, dirty, digest: hash.digest('hex') }
}

function git(args: readonly string[], root: string): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}
