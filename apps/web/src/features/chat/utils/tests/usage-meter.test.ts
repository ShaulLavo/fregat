import type { ProviderUsageWindow } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import { tightestUsageWindow, usageWindowTone } from '@/features/chat/utils/usage-meter'

function usageWindow(overrides: Partial<ProviderUsageWindow>): ProviderUsageWindow {
  return {
    id: 'five_hour',
    kind: 'session',
    label: 'Session',
    resetsAt: null,
    status: null,
    usedPercent: 10,
    windowMinutes: null,
    ...overrides,
  }
}

test('the provider status outranks the percentage', () => {
  expect(usageWindowTone(usageWindow({ status: 'warning', usedPercent: 12 }))).toBe('warning')
  expect(usageWindowTone(usageWindow({ status: 'rejected', usedPercent: 40 }))).toBe('destructive')
  // A full window that credits or overage still pay for is not a stop.
  expect(usageWindowTone(usageWindow({ status: 'warning', usedPercent: 100 }))).toBe('warning')
  expect(usageWindowTone(usageWindow({ usedPercent: 100 }))).toBe('destructive')
  expect(usageWindowTone(usageWindow({ usedPercent: 75 }))).toBe('warning')
  expect(usageWindowTone(usageWindow({ status: 'allowed', usedPercent: 50 }))).toBe('muted')
})

test('the tightest window is the worst tone before the highest use', () => {
  const busy = usageWindow({ id: 'seven_day', usedPercent: 74 })
  const warned = usageWindow({ id: 'five_hour', status: 'warning', usedPercent: 60 })

  expect(tightestUsageWindow([busy, warned])).toBe(warned)
  expect(tightestUsageWindow([])).toBeNull()
})
