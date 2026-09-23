import { describe, expect, it } from 'vitest'
import type { ProviderOptionDescriptor } from '@workspace/contracts'
import { modelSelectValue } from '../utils/model-options'

const descriptor: ProviderOptionDescriptor = {
  id: 'effort',
  label: 'Reasoning',
  type: 'select',
  currentValue: 'max',
  options: [
    { id: 'high', label: 'High', isDefault: true },
    { id: 'max', label: 'Max' },
    { id: 'ultrathink', label: 'Ultrathink' },
  ],
  promptInjectedValues: ['ultrathink'],
}

describe('modelSelectValue', () => {
  it.each([undefined, null, false, ' ', 'unsupported'])(
    'uses the provider current value for %s',
    (value) => {
      expect(modelSelectValue(descriptor, value)).toBe('max')
    },
  )

  it('uses the default choice for a prompt-injected value even when currentValue differs', () => {
    expect(modelSelectValue(descriptor, 'ultrathink')).toBe('high')
  })

  it('trims advertised selections and accepts open choices only for an empty select', () => {
    expect(modelSelectValue(descriptor, ' high ')).toBe('high')
    expect(modelSelectValue({ ...descriptor, options: [] }, ' future-v4 ')).toBe('future-v4')
    expect(modelSelectValue({ ...descriptor, currentValue: 'provider-owned' }, undefined)).toBe(
      'provider-owned',
    )
  })

  it('does not invent a choice or read a boolean descriptor as a select', () => {
    expect(
      modelSelectValue({ id: 'empty', label: 'Empty', type: 'select', options: [] }, undefined),
    ).toBeUndefined()
    expect(
      modelSelectValue(
        { id: 'fastMode', label: 'Fast', type: 'boolean', currentValue: true },
        'high',
      ),
    ).toBeUndefined()
    expect(modelSelectValue(undefined, 'high')).toBeUndefined()
  })
})
