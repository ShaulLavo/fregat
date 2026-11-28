import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'

const gate = join(import.meta.dirname, 'structure.ts')

test('requires exact cycle edges under the selected apps', () => {
  const root = mkdtempSync(join(tmpdir(), 'fregat-structure-'))
  try {
    writeFixture(
      root,
      'apps/web/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          verbatimModuleSyntax: true,
        },
      }),
    )
    writeFixture(root, 'apps/web/src/alpha/entry.ts', 'export const alpha = 1')
    writeFixture(root, 'apps/web/src/beta/entry.ts', 'export const beta = 2')
    writeFixture(root, 'apps/web/src/alpha/use-beta.ts', "export { beta } from '../beta/entry'")
    writeFixture(root, 'apps/web/src/beta/use-alpha.ts', "export { alpha } from '../alpha/entry'")
    writeFixture(root, 'apps/server/src/entry.ts', 'export const server = 1')
    writeFixture(root, 'apps/tui/src/entry.ts', 'export const tui = 1')
    writeFixture(root, 'apps/web/.unknot.allow', 'module-cycle src/alpha <-> src/beta')

    writeCycle(root, 'references/fixture')
    expect(check(root).exitCode).toBe(0)

    writeCycle(root, 'apps/web')
    const failed = check(root)
    expect(failed.exitCode).toBe(1)
    const diagnostics = failed.stderr.toString()
    expect(diagnostics).toContain('apps/web/src/alpha/cycle.ts [import-cycle-edge]')
    expect(diagnostics).toContain('src/alpha/cycle.ts imports src/beta/cycle.ts')
    expect(diagnostics).toContain('src/beta/cycle.ts imports src/alpha/cycle.ts')

    writeFixture(
      root,
      'apps/web/src/beta/cycle.ts',
      "import { alpha } from '../alpha/cycle'; export type Beta = number; export function beta() { return alpha(1) }",
    )
    writeFixture(
      root,
      'apps/web/src/alpha/cycle.ts',
      "import type { Beta } from '../beta/cycle'; export function alpha(value: Beta) { return value }",
    )
    expect(check(root).exitCode).toBe(0)
    writeFixture(
      root,
      'apps/web/src/alpha/cycle.ts',
      "import { type Beta } from '../beta/cycle'; export function alpha(value: Beta) { return value }",
    )
    const inlineType = check(root)
    expect(inlineType.exitCode).toBe(1)
    expect(inlineType.stderr.toString()).toContain('src/alpha/cycle.ts imports src/beta/cycle.ts')

    rmSync(join(root, 'apps/web/src/alpha/cycle.ts'))
    rmSync(join(root, 'apps/web/src/beta/cycle.ts'))
    rmSync(join(root, 'apps/web/src/beta/use-alpha.ts'))
    const fixed = check(root)
    expect(fixed.exitCode).toBe(1)
    expect(fixed.stderr.toString()).toContain(
      'Remove from apps/web/.unknot.allow: module-cycle src/alpha <-> src/beta',
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}, 60_000)

function check(cwd: string) {
  return Bun.spawnSync([process.execPath, gate], { cwd, timeout: 15_000 })
}

function writeCycle(root: string, app: string) {
  writeFixture(
    root,
    `${app}/src/alpha/cycle.ts`,
    "import { beta } from '../beta/cycle'; export function alpha() { return beta }",
  )
  writeFixture(
    root,
    `${app}/src/beta/cycle.ts`,
    "import { alpha } from '../alpha/cycle'; export function beta() { return alpha }",
  )
}

function writeFixture(root: string, name: string, content: string) {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content + '\n')
}
