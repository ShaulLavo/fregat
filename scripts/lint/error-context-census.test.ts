import { execFileSync } from 'node:child_process'
import { beforeAll, expect, test } from 'vitest'

const script = new URL('error-context-census.mjs', import.meta.url).pathname

let output = ''

// The whole-tree scan can outlast the per-test budget on CI.
beforeAll(() => {
  output = execFileSync('node', [script, '--check'], {
    cwd: new URL('../../', import.meta.url).pathname,
    encoding: 'utf8',
    timeout: 20_000,
  })
}, 30_000)

test('every constant-message error in the tree carries runtime context', () => {
  expect(output).toContain('gate: every constant-message error carries runtime context')
  expect(output).toMatch(/bare:\s+0 /)
})

// The census only measures entries whose message is a constant. A templated
// message already names its own facts at the call site, so `CONTEXT_MISSING`
// and friends are exempt by construction rather than by allowance.
test('a templated-message error is not measured', () => {
  const measured = Number(/census: (\d+) constant-message/.exec(output)?.[1])
  expect(measured).toBeGreaterThan(50)
  expect(output).not.toContain('CONTEXT_MISSING')
})
