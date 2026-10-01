import declared from './input-budgets.json' with { type: 'json' }
import { fail } from './errors.mjs'

export function inputBudget(configuration, key) {
  const reference = declared.inherited[configuration] ?? configuration
  const budget = declared.configurations[reference]
  const noiseMarginMs = budget?.groups[key]
  if (!Number.isFinite(noiseMarginMs) || noiseMarginMs < 0)
    fail(`Missing frozen input budget for ${configuration}/${key}`)
  return { noiseMarginMs, reference, inherited: reference !== configuration, ...budget.provenance }
}

export function historicalNegativeKeys(configuration) {
  const reference = declared.inherited[configuration] ?? configuration
  const keys = declared.configurations[reference]?.negativeKeys
  if (!keys) fail(`Missing historical negative reference for ${configuration}`)
  return keys
}
