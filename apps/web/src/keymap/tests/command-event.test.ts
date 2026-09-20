import { afterEach, vi } from 'vitest'
import { createError } from 'evlog'
import { expect, test } from '../../../test/fixtures'
import { createCommandEvent } from '../state/command-event'

afterEach(() => vi.unstubAllEnvs())

test('fast successful editor keys construct no diagnostic scope or payload', () => {
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  const base = vi.fn(() => ({ action: 'command.dispatch', area: 'command' }))
  const create = vi.fn(() => ({ end: vi.fn(), error: vi.fn(), warn: vi.fn() }))
  const scope = createCommandEvent(base, create, true)
  scope.end({ outcome: 'handled', durationMs: 1 })
  expect(base).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})

test.each([
  { outcome: 'handled', durationMs: 501 },
  { outcome: 'failed', durationMs: 1 },
  { outcome: 'unhandled', durationMs: 1 },
])('retains slow or unsuccessful command evidence: %j', (outcome) => {
  const end = vi.fn()
  const scope = createCommandEvent(
    () => ({ action: 'command.dispatch', area: 'command' }),
    () => ({ end, error: vi.fn(), warn: vi.fn() }),
    true,
  )
  scope.end(outcome)
  expect(end).toHaveBeenCalledExactlyOnceWith(outcome)
})

test('a late failure materializes the scope once and retains its final summary', () => {
  const error = vi.fn()
  const end = vi.fn()
  const create = vi.fn(() => ({ error, end, warn: vi.fn() }))
  const scope = createCommandEvent(
    () => ({ action: 'command.dispatch', area: 'command' }),
    create,
    true,
  )
  const failure = createError({ message: 'command failed', status: 500 })
  scope.error(failure)
  scope.end({ outcome: 'failed', durationMs: 1 })
  expect(create).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalledWith(failure, undefined)
  expect(end).toHaveBeenCalledTimes(1)
})

test('explicit debug diagnostics retain successful editor key summaries', () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'debug')
  const end = vi.fn()
  const scope = createCommandEvent(
    () => ({ action: 'command.dispatch', area: 'command' }),
    () => ({ end, error: vi.fn(), warn: vi.fn() }),
    true,
  )
  scope.end({ outcome: 'handled', durationMs: 1 })
  expect(end).toHaveBeenCalledTimes(1)
})
