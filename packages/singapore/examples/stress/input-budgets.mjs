import declared from './input-budgets.json' with { type: 'json' }
import { fail } from './errors.mjs'
import { inputHasWorkerTreeSitter } from './input-configurations.mjs'

export function inputBudget(configuration, key, loadProfile = 'quiet') {
  if (!['quiet', 'loaded'].includes(loadProfile)) fail('Unknown input load profile')
  const reference = declared.inherited[configuration] ?? configuration
  const budget = declared.configurations[reference]
  const frozenNoiseMarginMs = budget?.groups[key]
  if (!Number.isFinite(frozenNoiseMarginMs) || frozenNoiseMarginMs < 0)
    fail(`Missing frozen input budget for ${configuration}/${key}`)
  const loadedFloor =
    loadProfile === 'loaded' &&
    inputHasWorkerTreeSitter(configuration) &&
    !key.endsWith('/burstToPaintUpperBound') &&
    frozenNoiseMarginMs < 5
  return {
    frozenNoiseMarginMs,
    noiseMarginMs: loadedFloor ? 5 : frozenNoiseMarginMs,
    reason: loadedFloor
      ? 'Declared loaded Tree-sitter contention floor: 5 ms'
      : 'Frozen historical margin',
    reference,
    inherited: reference !== configuration,
    ...budget.provenance,
  }
}

export function historicalNegativeKeys(configuration) {
  const reference = declared.inherited[configuration] ?? configuration
  const keys = declared.configurations[reference]?.negativeKeys
  if (!keys) fail(`Missing historical negative reference for ${configuration}`)
  return keys
}
