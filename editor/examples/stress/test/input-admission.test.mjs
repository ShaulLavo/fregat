import { expect, test } from 'vitest'
import { admitDelayedControl, workloadGroups } from '../input-admission.mjs'

const fullRun = { config: {} }
const groups = workloadGroups(fullRun)

function delayedCheck(groupList = groups, dispatchPassed = () => false) {
  return {
    kind: 'delayed-control',
    metrics: groupList.flatMap((group) => [
      { key: `${group}/inputToApplied`, blocking: true, passed: false },
      { key: `${group}/dispatch`, blocking: true, passed: dispatchPassed(group) },
      { key: `${group}/inputToFrame`, blocking: true, passed: true },
      { key: `${group}/burstToPaintUpperBound`, blocking: false, passed: true },
    ]),
  }
}

test('admits a full delayed control only when every dispatch group failed', () => {
  expect(groups).toHaveLength(36)
  expect(admitDelayedControl(delayedCheck(), groups)).toMatchObject({
    admitted: true,
    full: true,
    blocking: 108,
    advisory: 36,
  })
})

test('rejects one passing dispatch group even when other metrics fail', () => {
  const verdict = admitDelayedControl(
    delayedCheck(groups, (group) => group === 'long-line/multiple/repeat'),
    groups,
  )
  expect(verdict).toMatchObject({ admitted: false })
  expect(verdict.reason).toMatch(/long-line\/multiple\/repeat passed/)
})

test('rejects a missing, duplicated or unexpected group and a wrong metric count', () => {
  expect(admitDelayedControl(delayedCheck(groups.slice(1)), groups).admitted).toBe(false)
  expect(admitDelayedControl(delayedCheck([...groups, groups[0]]), groups).admitted).toBe(false)
  expect(
    admitDelayedControl(delayedCheck([...groups, 'other/single/typing']), groups).admitted,
  ).toBe(false)
  const missingMetric = delayedCheck()
  missingMetric.metrics = missingMetric.metrics.filter(
    (metric) => metric.key !== `${groups[3]}/inputToFrame`,
  )
  expect(admitDelayedControl(missingMetric, groups).admitted).toBe(false)
  expect(admitDelayedControl({ ...delayedCheck(), kind: 'candidate' }, groups).admitted).toBe(false)
})

test('a legacy run without long-line is admitted only as partial', () => {
  const partialGroups = workloadGroups({ config: { unsupportedFixtures: ['long-line'] } })
  expect(partialGroups).toHaveLength(24)
  expect(admitDelayedControl(delayedCheck(partialGroups), partialGroups)).toMatchObject({
    admitted: true,
    full: false,
    blocking: 72,
    advisory: 24,
  })
})
