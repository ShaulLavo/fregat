import { modelSelectionSchema, providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  modelDefaultEffort,
  modelEffortLabel,
  modelEffortLevels,
  modelOptionDescriptors,
  modelSelectionEffort,
  modelSelectionOptionValue,
  reconcileModelEffort,
  withModelEffort,
  withModelOption,
  type ModelEffortCapability,
} from '@workspace/client-core/chat/providers/effort'
import { providerModel } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const codexInstanceId = v.parse(providerInstanceIdSchema, 'codex')
const claudeInstanceId = v.parse(providerInstanceIdSchema, 'claude')

const gpt = { model: 'gpt-5.5', providerInstanceId: codexInstanceId }
const opus = { model: 'claude-opus-5', providerInstanceId: claudeInstanceId }

// The live Codex catalog, plus one level with no description of its own.
const codexModel = providerModel({
  capabilities: {
    defaultReasoningEffort: 'medium',
    reasoningEfforts: [
      { description: 'Fastest, shallowest.', effort: 'low' },
      { description: 'Balanced.', effort: 'medium' },
      { description: 'Thinks harder.', effort: 'high' },
      { effort: 'xhigh' },
      { description: '   ', effort: 'ultra' },
    ],
  },
})

function capability(
  effortLevels: readonly string[],
  defaultEffort: string | null = null,
): ModelEffortCapability {
  return {
    defaultEffort,
    effortLevels: effortLevels.map((effort) => ({
      description: null,
      effort,
      label: modelEffortLabel(effort),
    })),
  }
}

test('a model that advertises no efforts offers no levels and no default', () => {
  expect(modelEffortLevels(providerModel())).toEqual([])
  expect(modelDefaultEffort(providerModel())).toBeNull()

  // Capabilities present but silent about reasoning is the same story.
  const quiet = providerModel({ capabilities: { supportsExtendedThinking: true } })
  expect(modelEffortLevels(quiet)).toEqual([])
  expect(modelDefaultEffort(quiet)).toBeNull()
})

test('advertised levels keep their order, id and provider copy', () => {
  const levels = modelEffortLevels(codexModel)

  expect(levels.map((level) => level.effort)).toEqual(['low', 'medium', 'high', 'xhigh', 'ultra'])
  expect(levels[0]).toEqual({
    description: 'Fastest, shallowest.',
    effort: 'low',
    label: 'Low',
  })
  // No description and a whitespace-only description are the same absence: the
  // chip must not open an empty tooltip.
  expect(levels[3].description).toBeNull()
  expect(levels[4].description).toBeNull()
})

test('labels are derived from the id, so an unknown level still reads', () => {
  expect(modelEffortLevels(codexModel).map((level) => level.label)).toEqual([
    'Low',
    'Medium',
    'High',
    'X-High',
    'Ultra',
  ])
  expect(modelEffortLabel('hyperdrive')).toBe('Hyperdrive')
})

test('the default is offered only when the model also advertises it', () => {
  expect(modelDefaultEffort(codexModel)).toBe('medium')
  expect(
    modelDefaultEffort(
      providerModel({
        capabilities: {
          defaultReasoningEffort: 'ultra',
          reasoningEfforts: [{ effort: 'low' }],
        },
      }),
    ),
  ).toBeNull()
})

test('the chosen level round-trips through a legal ModelSelection', () => {
  const selection = withModelEffort(gpt, 'xhigh')

  expect(selection).toEqual({ ...gpt, options: { reasoningEffort: 'xhigh' } })
  expect(modelSelectionEffort(selection)).toBe('xhigh')
  // The adapters read this off the wire, so it has to satisfy the contract.
  expect(v.parse(modelSelectionSchema, selection)).toEqual(selection)
})

test('clearing the level drops the options bag rather than leaving it empty', () => {
  expect(withModelEffort(withModelEffort(gpt, 'high'), null)).toEqual(gpt)
  expect(modelSelectionEffort(gpt)).toBeNull()
  expect(modelSelectionEffort(null)).toBeNull()
})

test('other adapters keep their own option keys', () => {
  const selection = withModelEffort({ ...gpt, options: { serviceTier: 'priority' } }, 'high')

  expect(selection.options).toEqual({ reasoningEffort: 'high', serviceTier: 'priority' })
  expect(withModelEffort(selection, null).options).toEqual({ serviceTier: 'priority' })
})

test('switching model keeps a level the new model also advertises', () => {
  const previous = withModelEffort(gpt, 'high')

  expect(reconcileModelEffort(previous, opus, capability(['low', 'high', 'max'], 'high'))).toEqual({
    ...opus,
    options: { reasoningEffort: 'high' },
  })
})

test('an unsupported level falls back to the new model default, never carries across', () => {
  const previous = withModelEffort(gpt, 'ultra')

  expect(reconcileModelEffort(previous, opus, capability(['low', 'high', 'max'], 'high'))).toEqual({
    ...opus,
    options: { reasoningEffort: 'high' },
  })
})

test('a model that advertises nothing drops the level entirely', () => {
  const previous = withModelEffort(gpt, 'ultra')

  expect(reconcileModelEffort(previous, opus, capability([]))).toEqual(opus)
  // No default to fall back to either.
  expect(reconcileModelEffort(previous, opus, capability(['low', 'high']))).toEqual(opus)
})

test('choosing no level stays no level, so the adapter sends no effort at all', () => {
  expect(reconcileModelEffort(gpt, opus, capability(['low', 'high'], 'high'))).toEqual(opus)
  expect(reconcileModelEffort(null, opus, capability(['low', 'high'], 'high'))).toEqual(opus)
})

test('a model advertises one descriptor per knob it actually exposes', () => {
  const descriptors = modelOptionDescriptors(
    providerModel({
      capabilities: {
        defaultReasoningEffort: 'medium',
        reasoningEfforts: [{ effort: 'low' }, { effort: 'medium' }],
        supportsExtendedThinking: true,
      },
    }),
  )

  expect(descriptors.map((descriptor) => [descriptor.id, descriptor.kind])).toEqual([
    ['reasoningEffort', 'select'],
    ['thinking', 'boolean'],
  ])
  expect(descriptors[0].choices.map((choice) => choice.value)).toEqual(['low', 'medium'])
  expect(descriptors[0].defaultValue).toBe('medium')
  // Absent thinking means "leave the provider's own setting alone", which is a
  // third state neither On nor Off can express — so there is no default to show.
  expect(descriptors[1].defaultValue).toBeNull()
})

test('a model that advertises no knobs yields no descriptors', () => {
  expect(modelOptionDescriptors(providerModel())).toEqual([])
})

test('a boolean option persists as a boolean, which is what the adapter reads', () => {
  const [thinking] = modelOptionDescriptors(
    providerModel({ capabilities: { supportsExtendedThinking: true } }),
  )
  const on = withModelOption(gpt, thinking, 'on')

  expect(on.options).toEqual({ thinking: true })
  expect(modelSelectionOptionValue(on, thinking)).toBe('on')
  expect(withModelOption(on, thinking, 'off').options).toEqual({ thinking: false })
  expect(withModelOption(on, thinking, null)).toEqual(gpt)
  expect(v.parse(modelSelectionSchema, on)).toEqual(on)
})

test('one descriptor never disturbs another one already chosen', () => {
  const [effort, thinking] = modelOptionDescriptors(
    providerModel({
      capabilities: { reasoningEfforts: [{ effort: 'high' }], supportsExtendedThinking: true },
    }),
  )
  const selection = withModelOption(withModelOption(gpt, effort, 'high'), thinking, 'on')

  expect(selection.options).toEqual({ reasoningEffort: 'high', thinking: true })
  expect(modelSelectionOptionValue(selection, effort)).toBe('high')
})
