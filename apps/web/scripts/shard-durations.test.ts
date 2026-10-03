import { expect, test } from 'vitest'
import { mergeDurations } from './shard-durations'

test('CI reports from independent checkouts share file keys and use median timings', () => {
  const reports = [1200, 8000, 1600].map((duration, index) => ({
    success: true as const,
    testResults: [
      {
        name: `/checkout-${index}/apps/web/src/slow.test.ts`,
        startTime: 100,
        endTime: 100 + duration,
      },
    ],
  }))
  expect(mergeDurations(reports)).toEqual({ 'src/slow.test.ts': 1.6 })
})

test('shard reports preserve their union and average the middle pair', () => {
  expect(
    mergeDurations([
      {
        success: true,
        testResults: [
          { name: '/ci/apps/web/src/a.test.ts', startTime: 0, endTime: 1000 },
          { name: '/ci/apps/web/src/b.test.tsx', startTime: 0, endTime: 3000 },
        ],
      },
      {
        success: true,
        testResults: [{ name: 'C:\\ci\\apps\\web\\src\\a.test.ts', startTime: 0, endTime: 2000 }],
      },
    ]),
  ).toEqual({ 'src/a.test.ts': 1.5, 'src/b.test.tsx': 3 })
})
