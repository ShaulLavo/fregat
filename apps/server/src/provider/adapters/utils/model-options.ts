import type { ModelSelection } from '@workspace/contracts'
import { asRecord } from './records'

export type ModelOptions = ModelSelection['options']

export function modelOptionValue(options: ModelOptions, key: string): unknown {
  if (!options) return undefined
  if (Array.isArray(options)) return modelOptionArrayValue(options, key)

  return asRecord(options)[key]
}

function modelOptionArrayValue(options: unknown[], key: string) {
  for (const option of options) {
    const record = asRecord(option)
    if (record.id === key) return record.value
  }

  return undefined
}
