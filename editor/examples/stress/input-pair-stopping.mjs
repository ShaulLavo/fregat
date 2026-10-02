import { inputBudget } from './input-budgets.mjs'

export function canStopInputPairs(samples, configuration, loadProfile = 'quiet') {
  if (samples.baseline.length !== 2 || samples.candidate.length !== 2) return false
  const first = samples.baseline[0]
  for (const metric of ['inputToApplied', 'dispatch', 'inputToFrame']) {
    const key = `${first.fixture}/${first.views}/${first.scenario}/${metric}`
    const budget = inputBudget(configuration, key, loadProfile).noiseMarginMs
    const differences = samples.baseline.map(
      (sample, index) =>
        p95(samples.candidate[index].latencyMs[metric]) - p95(sample.latencyMs[metric]),
    )
    if (differences.some((difference) => Math.abs(difference) > budget)) return false
    if (Math.max(...differences) - Math.min(...differences) > budget) return false
  }
  return true
}

function p95(values) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}
