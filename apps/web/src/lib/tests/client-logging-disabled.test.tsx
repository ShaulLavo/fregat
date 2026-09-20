import { vi } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import { initializeClientLogging } from '@/lib/client-logging'

test('master-off initialization installs no visibility listener or drain timer', () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'false')
  const listener = vi.spyOn(document, 'addEventListener')
  const timer = vi.spyOn(globalThis, 'setTimeout')
  try {
    initializeClientLogging()
    initializeClientLogging()
    expect(listener).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})
