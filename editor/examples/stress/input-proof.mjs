import { admitDelayedControl, workloadGroups } from './input-admission.mjs'
import { fail } from './errors.mjs'
import { calibrateInput, compareInput } from './input-results.mjs'

export function compareInputProof(controls, rerun, candidate, delayed) {
  if (delayed.environment.sourceHash !== controls[0].environment.sourceHash)
    fail('Delayed control source differs from baseline')
  const calibration = calibrateInput(controls)
  const holdout = compareInput(controls[0], rerun, calibration, { sameBuild: true })
  const candidateResult = compareInput(controls[0], candidate, calibration)
  const positive = compareInput(controls[0], delayed, calibration, { allowSlowdown: true })
  if (!holdout.passed) fail('Independent unchanged rerun exceeded the calibrated budget')
  const admission = admitDelayedControl(positive, workloadGroups(delayed))
  if (!admission.admitted || !admission.full)
    fail(`Delayed control admission failed: ${admission.reason}`)
  return { calibration, holdout, candidateResult, positive }
}
