import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { terminalSessionKey } from '@/features/terminal/state/session-registry'

test('the session key joins root and id with NUL, written as an escape so search reads the file', () => {
  expect(terminalSessionKey('/repo', 'one')).toBe('/repo\u0000one')
  const source = readFileSync(new URL('../state/session-registry.ts', import.meta.url))
  // A raw NUL makes the index and rg call the file binary, hiding it from workspace search.
  expect(source.includes(0)).toBe(false)
})
