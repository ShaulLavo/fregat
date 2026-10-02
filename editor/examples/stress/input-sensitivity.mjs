import { comparePairedInput, frameDetectionFloorKey, sensitivityPassed } from './input-paired.mjs'
import { fail } from './errors.mjs'

export function verifyInputSensitivity(stored, measurementHash, draws) {
  if (
    stored.measurementHash !== measurementHash ||
    !/^[a-f0-9]{64}$/.test(stored.measurementHash ?? '') ||
    !/^[a-f0-9]{64}$/.test(stored.validationHash ?? '') ||
    stored.schemaVersion !== 4 ||
    !stored.passed
  )
    fail('Invalid stored input sensitivity check')
  const input = verifyControl(stored.controls?.input, stored, 20, 0, draws)
  const frame = verifyControl(stored.controls?.frame, stored, 0, 20, draws)
  const floor = stored.frameDetectionFloor
  if (
    floor?.key !== frameDetectionFloorKey ||
    ![25, 30].includes(floor.delayMs) ||
    floor.attempts?.length !== (floor.delayMs === 25 ? 1 : 2)
  )
    fail('Invalid stored frame detection floor')
  const attempts = floor.attempts.map((check, index) => {
    const comparison = verifyControl(check, stored, 0, 25 + index * 5, draws)
    assertSameProducts(stored.controls.frame, check)
    return comparison
  })
  if (
    attempts.some(
      (check, index) => frameFloorRejected(check) !== (index === attempts.length - 1),
    ) ||
    !sensitivityPassed(input, 'input') ||
    !sensitivityPassed(frame, 'frame', attempts.at(-1))
  )
    fail('Stored stage sensitivity evidence failed')
  assertSameProducts(stored.controls.input, stored.controls.frame)
  return stored
}

export function frameFloorRejected(comparison) {
  return (
    comparison.metrics.find((metric) => metric.key === frameDetectionFloorKey)?.passed === false
  )
}

function verifyControl(check, identity, inputDelay, frameDelay, draws) {
  if (
    !check ||
    check.configuration !== 'native' ||
    check.baseline.environment.instrumentHash !== identity.instrumentHash ||
    check.candidate.environment.instrumentHash !== identity.instrumentHash ||
    check.baseline.environment.measurementHash !== identity.measurementHash ||
    check.candidate.environment.measurementHash !== identity.measurementHash ||
    check.baseline.environment.validationHash !== identity.validationHash ||
    check.candidate.environment.validationHash !== identity.validationHash ||
    check.candidate.config.slowdownMs !== inputDelay ||
    check.candidate.config.frameSlowdownMs !== frameDelay
  )
    fail('Invalid stored stage control identity or delay')
  assertSameProducts(check, check)
  return comparePairedInput(
    check.baseline,
    check.candidate,
    check.schedule,
    check.comparison.seed,
    draws,
  )
}

function assertSameProducts(left, right) {
  const product = left.baseline.environment.packageSet
  for (const run of [left.candidate, right.baseline, right.candidate]) {
    const observed = run.environment.packageSet
    if (product.sourceHash !== observed.sourceHash || product.buildHash !== observed.buildHash)
      fail('Stored sensitivity controls use different product bytes')
  }
}
