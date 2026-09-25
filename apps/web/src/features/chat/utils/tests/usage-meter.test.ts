import type { ProviderUsageWindow } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import {
  formatResetIn,
  liveUsageWindows,
  tightestUsageWindow,
  usageCheckedLabel,
  usagePace,
  usagePaceLabel,
  usageRefetchIntervalMs,
  usageWindowTone,
} from '@/features/chat/utils/usage-meter'

const NOW = Date.parse('2026-09-24T12:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

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

test('a window leaves once its reset passes, and old readings say so', () => {
  const passed = usageWindow({ id: 'passed', resetsAt: at(-1) })
  const open = usageWindow({ id: 'open', resetsAt: at(60_000) })

  expect(liveUsageWindows([passed, open, usageWindow({})], NOW).map((w) => w.id)).toEqual([
    'open',
    'five_hour',
  ])
  expect(usageCheckedLabel(at(-10_000), NOW)).toBe('Checked just now')
  expect(usageCheckedLabel(at(-4 * 60_000), NOW)).toBe('Checked 4m ago')
  expect(usageCheckedLabel(at(-20 * 60_000), NOW)).toBe('Checked 20m ago · may be out of date')
})

test('a running session near a limit reads more often', () => {
  expect(usageRefetchIntervalMs([usageWindow({ usedPercent: 40 })])).toBe(60_000)
  expect(usageRefetchIntervalMs([usageWindow({ usedPercent: 92 })])).toBe(15_000)
})

test('reset countdowns stay coarse and never print 60 minutes', () => {
  expect(formatResetIn(at(12 * 60_000 - 1), NOW)).toBe('12m')
  expect(formatResetIn(at(4 * 3_600_000 - 30_000), NOW)).toBe('4h')
  expect(formatResetIn(at(3 * 3_600_000 + 20 * 60_000), NOW)).toBe('3h 20m')
  expect(formatResetIn(at(5 * 86_400_000 + 5 * 3_600_000), NOW)).toBe('5d 5h')
  expect(formatResetIn(at(-1), NOW)).toBeNull()
  expect(formatResetIn(null, NOW)).toBeNull()
})

test('pace compares use with how much of the window has gone', () => {
  // A five-hour window with four hours left: a fifth of it has passed.
  const window = (usedPercent: number) =>
    usageWindow({ resetsAt: at(4 * 3_600_000), usedPercent, windowMinutes: 300 })

  const ahead = usagePace(window(60), NOW)
  expect(ahead).toMatchObject({ elapsedPercent: 20, verdict: 'ahead' })
  // 60% in one hour is 40% more in 40 minutes, well before the reset.
  expect(ahead && usagePaceLabel(ahead)).toBe('Ahead of pace · runs out in 40m')
  expect(usagePace(window(22), NOW)?.verdict).toBe('on')
  expect(usagePace(window(5), NOW)?.verdict).toBe('under')
  expect(usagePace(usageWindow({ resetsAt: at(60_000), windowMinutes: null }), NOW)).toBeNull()
  expect(usagePace(window(100), NOW)).toBeNull()
})
