import { expect, test } from 'vitest'
import { verifyX6Journal } from './ghostty-x6-public-journal.ts'

const startedAt = '2026-10-04T00:00:00.000Z'
const endedAt = '2026-10-04T00:00:00.010Z'
const open = { id: 'actual-job', startedAt, endedAt: null, class: 'light' }
const closed = { ...open, endedAt }

test('preserves known snapshot jobs, final-only jobs and gap-only telemetry', () => {
  expect(() => verifyX6Journal([], [{}, {}])).not.toThrow()
  expect(() =>
    verifyX6Journal([closed], [{ [open.id]: open }, { [closed.id]: closed }]),
  ).not.toThrow()
  expect(() => verifyX6Journal([open], [{ [open.id]: open }])).not.toThrow()
  expect(() => verifyX6Journal([closed, { ...closed, id: 'gap-only' }], [{}])).not.toThrow()
})

test('rejects a truncated final journal with a known snapshot job', () => {
  expect(() => verifyX6Journal([], [{ [open.id]: open }])).toThrow()
})

test('rejects changed identity, finished-job regression and inconsistent snapshots', () => {
  expect(() =>
    verifyX6Journal([{ ...closed, startedAt: endedAt }], [{ [open.id]: open }]),
  ).toThrow()
  const changedClass = { ...closed, class: 'suite' }
  expect(() => verifyX6Journal([changedClass], [{ [open.id]: open }])).toThrow()
  const changedFinish = { ...closed, endedAt: '2026-10-04T00:00:00.011Z' }
  expect(() => verifyX6Journal([changedFinish], [{ [closed.id]: closed }])).toThrow()
  expect(() => verifyX6Journal([open], [{ [closed.id]: closed }])).toThrow()
  expect(() =>
    verifyX6Journal([{ ...closed, endedAt: startedAt }], [{ [open.id]: open }]),
  ).toThrow()
  expect(() => verifyX6Journal([closed], [{ [closed.id]: closed }, { [open.id]: open }])).toThrow()
  expect(() => verifyX6Journal([closed, closed], [{}])).toThrow()
  expect(() => verifyX6Journal([closed], [{ 'wrong-key': closed }])).toThrow()
})
