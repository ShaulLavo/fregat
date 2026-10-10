import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'

const root = resolve(import.meta.dirname, '..')
const discoveredTests = v.array(v.object({ file: v.string(), projectName: v.optional(v.string()) }))

function discover(cwd: string, args: readonly string[]) {
  const result = Bun.spawnSync(
    [process.execPath, '--bun', resolve(root, 'node_modules/vitest/vitest.mjs'), 'list'].concat(
      args,
      ['--json'],
    ),
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
  return v.parse(discoveredTests, JSON.parse(new TextDecoder().decode(result.stdout)))
}

test('default suites collect first-party title and history tests; T3 comparisons have a manual suite', () => {
  const server = discover(resolve(root, 'apps/server'), [
    'src/orchestration/tests/title-context',
    'src/orchestration/tests/title-links',
  ])
  const web = discover(resolve(root, 'apps/web'), ['src/features/terminal/tests/history'])
  expect(server.length).toBeGreaterThan(0)
  expect(web.length).toBeGreaterThan(0)
  expect(server.concat(web).some(({ file }) => file.endsWith('.t3code.test.ts'))).toBe(false)

  const manual = discover(root, ['--config', 'vitest.t3code.config.mjs'])
  expect(manual).toHaveLength(4)
  expect(manual.every(({ file }) => file.endsWith('.t3code.test.ts'))).toBe(true)
  expect(new Set(manual.map(({ projectName }) => projectName))).toEqual(
    new Set(['t3code-server', 't3code-web']),
  )
}, 15_000)
