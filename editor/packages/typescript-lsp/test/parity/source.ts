import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editorRoot = resolve(import.meta.dirname, '../../../..')
const workspaceRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: editorRoot,
  encoding: 'utf8',
}).trim()

const SOURCE_PATHS = [
  'bun.lock',
  'package.json',
  'editor/package.json',
  'editor/scripts/browser-test-responses.ts',
  'editor/scripts/workspace-root.ts',
  'editor/packages/lsp/src',
  'editor/packages/lsp/package.json',
  'editor/packages/lsp-plugin/src',
  'editor/packages/lsp-plugin/package.json',
  'editor/packages/typescript-lsp/src',
  'editor/packages/typescript-lsp/package.json',
  'editor/packages/typescript-lsp/test',
  'editor/packages/typescript-lsp/vitest.config.ts',
  'editor/packages/typescript-lsp/vitest.browser.config.ts',
  'apps/server/src/lsp',
  'apps/server/test/factories/typescript-runtime.ts',
  'apps/server/test/factories/typescript-parity.ts',
  'scripts/typescript-parity.mjs',
  'scripts/typescript-parity.test.mjs',
  'scripts/typescript-parity-capture.mjs',
]

export function paritySourceIdentity(root = workspaceRoot) {
  const revision = git(['rev-parse', 'HEAD'], root)
  const dirty = git(['status', '--porcelain'], root).length > 0
  const paths =
    root === editorRoot
      ? SOURCE_PATHS.filter((path) => path.startsWith('editor/')).map((path) =>
          path.slice('editor/'.length),
        )
      : SOURCE_PATHS
  const files = git(
    ['ls-files', '--cached', '--others', '--exclude-standard', '--'].concat(paths),
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
