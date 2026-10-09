import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

export function runTreeSitter(args, cwd) {
  const result = spawnSync(
    'bun',
    ['x', '--package', 'tree-sitter-cli@0.27.0', 'tree-sitter'].concat(args),
    { cwd, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `tree-sitter: ${result.error?.message ?? result.stderr}`)
  return result.stdout.trim()
}
