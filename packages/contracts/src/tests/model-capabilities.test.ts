import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { modelSelectionSchema, providerModelSchema, providerOptionDescriptorSchema } from '../index'

const baseModel = { isCustom: false, name: 'GPT-5.5', slug: 'gpt-5.5' }

describe('provider model options', () => {
  it('allows a model to advertise no options', () => {
    expect(v.parse(providerModelSchema, baseModel).capabilities).toBeNull()
    expect(
      v.parse(providerModelSchema, { ...baseModel, capabilities: null }).capabilities,
    ).toBeNull()
  })

  it('preserves provider IDs, labels, descriptions, defaults and prompt-injected values', () => {
    const optionDescriptors = [
      {
        id: 'serviceTier',
        label: 'Service tier',
        description: 'Provider-defined scheduling',
        type: 'select',
        currentValue: 'economy-v2',
        options: [
          { id: 'default', label: 'Standard', isDefault: true },
          { id: 'economy-v2', label: 'Economy', description: 'Lower priority' },
        ],
      },
      {
        id: 'effort',
        label: 'Effort',
        type: 'select',
        options: [{ id: 'future-effort', label: 'Future effort' }],
        promptInjectedValues: ['future-effort'],
      },
      { id: 'thinking', label: 'Thinking', type: 'boolean', currentValue: false },
    ]
    const parsed = v.parse(providerModelSchema, {
      ...baseModel,
      capabilities: { optionDescriptors },
    })
    expect(parsed.capabilities?.optionDescriptors).toEqual(optionDescriptors)
  })

  it.each([
    { type: 'select', currentValue: false, options: [] },
    { type: 'boolean', currentValue: 'on' },
    { type: 'select', options: [{ id: ' ', label: 'Empty ID' }] },
  ])('rejects mismatched descriptor values at the boundary: %j', (fields) => {
    expect(() =>
      v.parse(providerOptionDescriptorSchema, { id: 'option', label: 'Option', ...fields }),
    ).toThrow()
  })

  it('keeps future effort and tier IDs and real booleans in the selection', () => {
    const selection = {
      model: 'gpt-5.5',
      providerInstanceId: 'codex',
      options: { reasoningEffort: 'future-effort', serviceTier: 'economy-v2', thinking: false },
    }
    expect(v.parse(modelSelectionSchema, selection)).toEqual(selection)
  })

  it('does not materialize absent provider defaults into the selection', () => {
    expect(
      v.parse(modelSelectionSchema, { model: 'gpt-5.5', providerInstanceId: 'codex' }).options,
    ).toBeUndefined()
  })
})
