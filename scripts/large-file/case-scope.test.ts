import { expect, test } from 'vitest'

import { caseScopeCommand } from './case-scope'

const scope = { unit: 'case.scope', memoryMiB: 2560, command: ['bun', 'bench.ts'] }

test.skipIf(process.platform !== 'linux')('joins the heavy job slice when one is named', () => {
  expect(caseScopeCommand({ ...scope, slice: 'lane_x.slice' })).toContain('--slice=lane_x.slice')
  expect(caseScopeCommand(scope).some((arg) => arg.startsWith('--slice'))).toBe(false)
  expect(caseScopeCommand(scope)).toContain('MemoryMax=2560M')
})
