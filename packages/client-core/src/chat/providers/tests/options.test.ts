import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  modelSelectionSchema,
  providerInstanceIdSchema,
  type ProviderOptionDescriptor,
} from '@workspace/contracts'
import {
  modelDefaultEffort,
  modelEffortLevels,
  modelOptionDefaultValue,
  modelOptionDescriptors,
  modelSelectionOptionValue,
  reconcileModelOptions,
  withModelOption,
} from '../options'

const model = { model: 'model-a', providerInstanceId: v.parse(providerInstanceIdSchema, 'codex') }
const next = { ...model, model: 'model-b' }
const effort: ProviderOptionDescriptor = {
  id: 'reasoningEffort',
  label: 'Reasoning',
  type: 'select',
  currentValue: 'medium',
  options: [
    { id: 'medium', label: 'Balanced', isDefault: true },
    { id: 'future-effort', label: 'Beyond', description: 'Provider copy' },
  ],
}
const tier: ProviderOptionDescriptor = {
  id: 'serviceTier',
  label: 'Service tier',
  type: 'select',
  options: [
    { id: 'default', label: 'Standard', isDefault: true },
    { id: 'economy-v2', label: 'Economy' },
  ],
}
const thinking: ProviderOptionDescriptor = {
  id: 'thinking',
  label: 'Extended thinking',
  type: 'boolean',
  currentValue: true,
}

test('advertised choices retain provider IDs, labels, descriptions and ordering', () => {
  const catalog = { capabilities: { optionDescriptors: [effort, tier, thinking] } }
  expect(modelOptionDescriptors(catalog)).toEqual([effort, tier, thinking])
  expect(modelEffortLevels(catalog)).toEqual([
    { description: null, effort: 'medium', label: 'Balanced' },
    { description: 'Provider copy', effort: 'future-effort', label: 'Beyond' },
  ])
  expect(modelDefaultEffort(catalog)).toBe('medium')
  expect(modelEffortLevels({ capabilities: null })).toEqual([])
})

test('boolean false and future select values round-trip through the contract', () => {
  const selection = withModelOption(
    withModelOption(model, effort, 'future-effort'),
    thinking,
    false,
  )
  expect(v.parse(modelSelectionSchema, selection)).toEqual(selection)
  expect(modelSelectionOptionValue(selection, thinking)).toBe(false)
  expect(modelSelectionOptionValue(selection, effort)).toBe('future-effort')
})

test('clearing a choice preserves other overrides, then drops the empty options bag', () => {
  const selection = withModelOption(withModelOption(model, tier, 'economy-v2'), thinking, false)
  const withoutTier = withModelOption(selection, tier, null)
  expect(withoutTier.options).toEqual({ thinking: false })
  expect(withModelOption(withoutTier, thinking, null)).toEqual(model)
})

test('untouched defaults display but do not become explicit choices', () => {
  expect(modelOptionDefaultValue(effort)).toBe('medium')
  expect(modelOptionDefaultValue(tier)).toBe('default')
  expect(modelOptionDefaultValue(thinking)).toBe(true)
  expect(modelSelectionOptionValue(model, tier)).toBeNull()
  expect(reconcileModelOptions(model, next, [effort, tier, thinking])).toEqual(next)
})

test('model changes keep all supported explicit choices, including false', () => {
  const previous = {
    ...model,
    options: { reasoningEffort: 'future-effort', serviceTier: 'economy-v2', thinking: false },
  }
  expect(reconcileModelOptions(previous, next, [effort, tier, thinking])).toEqual({
    ...next,
    options: previous.options,
  })
})

test('unsupported explicit choices adopt the target defaults and unsupported keys disappear', () => {
  const previous = {
    ...model,
    options: { reasoningEffort: 'obsolete', serviceTier: 'unavailable', contextWindow: '1m' },
  }
  expect(reconcileModelOptions(previous, next, [effort, tier])).toEqual({
    ...next,
    options: { reasoningEffort: 'medium', serviceTier: 'default' },
  })
  expect(reconcileModelOptions(previous, next, [])).toEqual(next)
})

test('invalid select values with no advertised default are removed', () => {
  const noDefault = { ...tier, options: [{ id: 'economy-v2', label: 'Economy' }] }
  expect(
    reconcileModelOptions({ ...model, options: { serviceTier: 'gone' } }, next, [noDefault]),
  ).toEqual(next)
})

test('provider currentValue takes precedence over isDefault, and false is a real default', () => {
  expect(modelOptionDefaultValue({ ...tier, currentValue: 'economy-v2' })).toBe('economy-v2')
  expect(modelOptionDefaultValue({ ...thinking, currentValue: false })).toBe(false)
})

test('an open select with no advertised choices retains an explicit provider value', () => {
  const open: ProviderOptionDescriptor = { ...tier, options: [] }
  expect(
    reconcileModelOptions({ ...model, options: { serviceTier: ' future ' } }, next, [open]),
  ).toEqual({
    ...next,
    options: { serviceTier: 'future' },
  })
})

test('prompt-injected effort does not become a persistent native effort override', () => {
  const injected: ProviderOptionDescriptor = { ...effort, promptInjectedValues: ['future-effort'] }
  expect(
    reconcileModelOptions({ ...model, options: { reasoningEffort: 'future-effort' } }, next, [
      injected,
    ]),
  ).toEqual({
    ...next,
    options: { reasoningEffort: 'medium' },
  })
})
