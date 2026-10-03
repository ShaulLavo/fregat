import { expect, test } from 'vitest'

import { checkFirstLoad, pinsFrom, type GateReport, type Pins } from './bundle-gate'

const baseline: GateReport = {
  firstLoad: { scriptGzip: 1_000_000 },
  phoneFirstLoad: { scriptGzip: 600_000 },
  phoneSessionFirstLoad: { scriptGzip: 600_000 },
  owners: [
    { owner: 'features/chat', firstLoadGzip: 120_000 },
    { owner: 'node_modules/react-dom', firstLoadGzip: 60_000 },
    { owner: 'features/logs', firstLoadGzip: 500 },
  ],
}
const pins: Pins = pinsFrom(baseline, null, 'first pin', '2026-09-25T00:00:00.000Z')

test('the pinned build passes', () => {
  expect(checkFirstLoad(baseline, pins).passed).toBe(true)
})

test('an owner that grew past its margin fails and is named', () => {
  const grown: GateReport = {
    firstLoad: { scriptGzip: 1_020_000 },
    phoneFirstLoad: { scriptGzip: 600_000 },
    phoneSessionFirstLoad: { scriptGzip: 600_000 },
    owners: [
      { owner: 'features/chat', firstLoadGzip: 140_000 },
      { owner: 'node_modules/react-dom', firstLoadGzip: 60_000 },
    ],
  }
  const result = checkFirstLoad(grown, pins)
  expect(result.passed).toBe(false)
  expect(result.failures.map((failure) => failure.owner)).toEqual(['features/chat'])
})

test('a new owner in first load is named when it passes the floor', () => {
  const added: GateReport = {
    firstLoad: { scriptGzip: 1_030_000 },
    phoneFirstLoad: { scriptGzip: 600_000 },
    phoneSessionFirstLoad: { scriptGzip: 600_000 },
    owners: [...baseline.owners, { owner: 'node_modules/shiki', firstLoadGzip: 30_000 }],
  }
  expect(checkFirstLoad(added, pins).failures).toEqual([
    { owner: 'node_modules/shiki', pinned: 0, now: 30_000 },
  ])
})

test('small drift inside the margins passes, and a tiny owner has a floor', () => {
  const drift: GateReport = {
    firstLoad: { scriptGzip: 1_005_000 },
    phoneFirstLoad: { scriptGzip: 600_000 },
    phoneSessionFirstLoad: { scriptGzip: 600_000 },
    owners: [
      { owner: 'features/chat', firstLoadGzip: 124_000 },
      { owner: 'node_modules/react-dom', firstLoadGzip: 60_000 },
      { owner: 'features/logs', firstLoadGzip: 2_400 },
    ],
  }
  expect(checkFirstLoad(drift, pins).passed).toBe(true)
})

test('total growth spread thin over owners still fails on the total', () => {
  const spread: GateReport = {
    firstLoad: { scriptGzip: 1_020_000 },
    phoneFirstLoad: { scriptGzip: 600_000 },
    phoneSessionFirstLoad: { scriptGzip: 600_000 },
    owners: baseline.owners,
  }
  const result = checkFirstLoad(spread, pins)
  expect(result.passed).toBe(false)
  expect(result.failures[0]?.owner).toBe('(total)')
})

test('a phone first load that grew past its margin fails on the phone total', () => {
  const heavier: GateReport = { ...baseline, phoneFirstLoad: { scriptGzip: 620_000 } }
  const result = checkFirstLoad(heavier, pins)
  expect(result.passed).toBe(false)
  expect(result.failures).toEqual([{ owner: '(phone total)', pinned: 600_000, now: 620_000 }])
})

test('phone metadata gets 300 gzip bytes while total and owner limits stay fixed', () => {
  const atLimit: GateReport = {
    ...baseline,
    phoneFirstLoad: { scriptGzip: 606_300 },
    phoneSessionFirstLoad: { scriptGzip: 606_300 },
  }
  const result = checkFirstLoad(atLimit, pins)
  expect(result.passed).toBe(true)
  expect(result.phone).toEqual({ pinned: 600_000, now: 606_300, limit: 606_300 })
  expect(result.total.limit).toBe(1_010_000)

  const overPhone = checkFirstLoad(
    { ...atLimit, phoneSessionFirstLoad: { scriptGzip: 606_301 } },
    pins,
  )
  expect(overPhone.failures).toEqual([{ owner: '(phone total)', pinned: 600_000, now: 606_301 }])
  const overOwner = checkFirstLoad(
    { ...atLimit, owners: [{ owner: 'features/chat', firstLoadGzip: 126_001 }] },
    pins,
  )
  expect(overOwner.failures).toEqual([{ owner: 'features/chat', pinned: 120_000, now: 126_001 }])
  const overTotal = checkFirstLoad({ ...atLimit, firstLoad: { scriptGzip: 1_010_001 } }, pins)
  expect(overTotal.failures).toEqual([{ owner: '(total)', pinned: 1_000_000, now: 1_010_001 }])
})

test('re-pinning keeps the history with its reason', () => {
  const next = pinsFrom(baseline, pins, 'Plan 108 landed', '2026-09-26T00:00:00.000Z')
  expect(next.history.map((entry) => entry.reason)).toEqual(['first pin', 'Plan 108 landed'])
})

test('a direct conversation boot is gated even when the sessions list is smaller', () => {
  const heavier = { ...baseline, phoneSessionFirstLoad: { scriptGzip: 620_000 } }
  expect(checkFirstLoad(heavier, pins).failures).toEqual([
    { owner: '(phone total)', pinned: 600_000, now: 620_000 },
  ])
})
