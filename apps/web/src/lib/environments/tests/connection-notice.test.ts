import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'
import { expect, test } from '../../../../test/fixtures'

const origin = 'http://localhost:38078'

test('initial connection attempts do not present cached identity as a connection failure', () => {
  const entry = createEnvironmentEntry(origin, origin)
  for (const phase of ['offline', 'launching', 'connecting', 'live'] as const) {
    expect(hasConnectionNotice({ ...entry, phase })).toBe(false)
  }
})

test('failed attempts, retries, and lost connections remain visible', () => {
  const entry = createEnvironmentEntry(origin, origin)
  expect(hasConnectionNotice({ ...entry, phase: 'offline', lastErrorAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'connecting', lastErrorAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'reconnecting', connectedAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'blocked' })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'identity-drift' })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'live', lastErrorAt: 1 })).toBe(false)
})
