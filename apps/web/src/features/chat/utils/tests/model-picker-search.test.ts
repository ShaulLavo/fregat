import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type ProviderModel,
  type ProviderSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'

import { rankModelPickerOptions } from '@/features/chat/utils/model-picker-search'
import { providerModelOptions } from '@workspace/client-core/chat/providers/models'
import { providerSnapshot } from '../../../../../test/factories/chat'

function model(name: string, slug: string, shortName?: string): ProviderModel {
  return { capabilities: null, isCustom: false, name, shortName, slug }
}

function snapshot(
  displayLabel: string,
  driverKind: string,
  models: readonly ProviderModel[],
): ProviderSnapshot {
  return providerSnapshot({
    displayLabel,
    driverKind: v.parse(providerDriverKindSchema, driverKind),
    models: [...models],
    providerInstanceId: v.parse(providerInstanceIdSchema, driverKind),
  })
}

// The Atlas provider's label collides with the Nimbus provider's model name, so
// field priority is the only thing that can separate two identical-tier hits.
function options() {
  return providerModelOptions([
    snapshot('Atlas', 'orion', [model('Nova', 'nova'), model('Optimus', 'optimus')]),
    snapshot('Nimbus', 'zephyr', [model('Atlas', 'atlas'), model('Opus', 'opus', 'Opus 5')]),
  ])
}

function rankedNames(query: string) {
  return rankModelPickerOptions(options(), query).map((option) => option.name)
}

test('an empty query keeps the caller order untouched', () => {
  expect(rankedNames('')).toEqual(['Nova', 'Optimus', 'Atlas', 'Opus'])
  expect(rankedNames('   ')).toEqual(['Nova', 'Optimus', 'Atlas', 'Opus'])
})

test('every query token must match some field or the option is dropped', () => {
  expect(rankedNames('opus')).toEqual(['Opus', 'Optimus'])
  expect(rankedNames('opus zzz')).toEqual([])
})

test('multi-token queries keep only options matching every token', () => {
  expect(rankedNames('atlas nova')).toEqual(['Nova'])
})

test('an exact match beats a fuzzy subsequence match', () => {
  // "opus" is the exact name of one model and only a subsequence of "Optimus".
  expect(rankedNames('opus')).toEqual(['Opus', 'Optimus'])
})

test('tokens shorter than three characters never fuzzy-match', () => {
  // "os" is a subsequence of "opus"/"optimus" but a substring of neither.
  expect(rankedNames('os')).toEqual([])
  // The same shape at three characters is allowed to fuzzy-match.
  expect(rankedNames('ous')).toEqual(['Opus', 'Optimus'])
})

test('a name hit outranks an equally good provider-label hit', () => {
  // "atlas" is exactly the Nimbus model's name and exactly the other provider's
  // display label — same tier, so only the field penalty decides.
  expect(rankedNames('atlas')).toEqual(['Atlas', 'Nova', 'Optimus'])
})

test('a short-name hit outranks a driver-kind hit of the same tier', () => {
  const ranked = rankModelPickerOptions(
    providerModelOptions([
      snapshot('Nimbus', 'zephyr', [model('Opus', 'opus', 'Nebula')]),
      snapshot('Atlas', 'orion', [model('Nova', 'nova', 'Zephyr')]),
    ]),
    'zephyr',
  )

  expect(ranked.map((option) => option.name)).toEqual(['Nova', 'Opus'])
})

test('ties fall back to the caller order', () => {
  const ranked = rankModelPickerOptions(
    providerModelOptions([
      snapshot('Atlas', 'orion', [model('Nova', 'nova'), model('Nova', 'nova-2')]),
    ]),
    'nova',
  )

  expect(ranked.map((option) => option.modelSelection.model)).toEqual(['nova', 'nova-2'])
})
