import type { ProviderSnapshot } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import {
  applyModelPreferences,
  modelPreferenceRows,
} from '@workspace/client-core/chat/providers/preferences'
import { providerModelOptions } from '@workspace/client-core/chat/providers/models'

import { withMovedModel } from '../utils/patch'

const ref = (model: string) => ({ model, providerInstanceId: 'codex' }) as never
const option = (model: string) =>
  ({ key: model, label: model, modelSelection: ref(model) }) as never

describe('withMovedModel', () => {
  it('names the whole displayed list so a move is one place on screen', () => {
    // Computed against the rendered sequence, not the stored order: the stored
    // one is sparse, and appending to it moves a model to the *top* of the
    // picker rather than one place down.
    const displayed = [ref('a'), ref('b'), ref('c')]

    expect(withMovedModel(displayed, ref('b'), 1)).toEqual([ref('a'), ref('c'), ref('b')])
    expect(withMovedModel(displayed, ref('b'), -1)).toEqual([ref('b'), ref('a'), ref('c')])
  })

  it('moves a model one place', () => {
    const displayed = [ref('a'), ref('b'), ref('c')]

    expect(withMovedModel(displayed, ref('c'), -1)).toEqual([ref('a'), ref('c'), ref('b')])
    expect(withMovedModel(displayed, ref('a'), 1)).toEqual([ref('b'), ref('a'), ref('c')])
  })

  it('refuses to move past either end', () => {
    const displayed = [ref('a'), ref('b')]

    expect(withMovedModel(displayed, ref('a'), -1)).toEqual(displayed)
    expect(withMovedModel(displayed, ref('b'), 1)).toEqual(displayed)
  })

  it('round-trips through the picker so a move down really reads as down', () => {
    const options = [option('a'), option('b'), option('c')]
    const displayed = [ref('a'), ref('b'), ref('c')]

    const order = withMovedModel(displayed, ref('a'), 1)
    const ordered = applyModelPreferences(options, { hidden: [], order })

    expect(ordered.map((entry) => entry.key)).toEqual(['b', 'a', 'c'])
  })
})

describe('the order reaches the picker', () => {
  it('leads with the ranked models and keeps the rest in provider order', () => {
    const options = [option('a'), option('b'), option('c')]

    const ordered = applyModelPreferences(options, { hidden: [], order: [ref('c')] })

    // Unranked models keep provider order exactly: a comparator that invented a
    // rank for them would quietly reshuffle the provider's own sequence.
    expect(ordered.map((entry) => entry.key)).toEqual(['c', 'a', 'b'])
  })

  it('drops hidden models entirely', () => {
    const options = [option('a'), option('b')]

    const visible = applyModelPreferences(options, { hidden: [ref('a')], order: [] })

    expect(visible.map((entry) => entry.key)).toEqual(['b'])
  })
})

// Composed exactly as `ModelSection` composes it, rather than calling
// `modelPreferenceRows` on a hand-made list: the defect these guard against was
// passing preferences into `providerModelOptions`, which subtracts hidden models
// before the rows are built. Only going through the real seam catches that.
const rowsFor = (
  snapshots: readonly ProviderSnapshot[],
  preferences: { hidden?: readonly never[]; order?: readonly never[] } = {},
) =>
  modelPreferenceRows(providerModelOptions(snapshots), {
    hidden: preferences.hidden ?? [],
    order: preferences.order ?? [],
  })

function snapshot(id: string, slugs: readonly string[]): ProviderSnapshot {
  return {
    auth: { status: 'authenticated' },
    availability: 'available',
    checkedAt: '2026-08-13T00:00:00.000Z',
    displayLabel: id,
    driverKind: 'codex',
    enabled: true,
    installed: true,
    models: slugs.map((slug) => ({ name: slug, slug })),
    providerInstanceId: id,
    status: 'ready',
    version: null,
  } as unknown as ProviderSnapshot
}

describe('the settings model list', () => {
  it('lists what the providers offer, not only what was already decided', () => {
    // Settings remember opinions, so listing them meant the screen for forming
    // an opinion was empty until you had somehow formed one somewhere else.
    const rows = rowsFor([snapshot('codex', ['gpt-5-codex', 'gpt-5-codex-mini'])])

    expect(rows.map((row) => row.ref.model)).toEqual(['gpt-5-codex', 'gpt-5-codex-mini'])
    expect(rows.every((row) => !row.hidden)).toBe(true)
  })

  it('keeps a hidden model in the list, marked off rather than removed', () => {
    const rows = rowsFor([snapshot('codex', ['gpt-5-codex', 'gpt-5-codex-mini'])], {
      hidden: [ref('gpt-5-codex-mini')],
    })

    // The regression this whole seam exists to prevent: subtracting the hidden
    // model here would delete the row carrying the switch that un-hides it, so
    // one click would hide a model permanently.
    expect(rows.map((row) => row.ref.model)).toEqual(['gpt-5-codex', 'gpt-5-codex-mini'])
    expect(rows.find((row) => row.ref.model === 'gpt-5-codex-mini')?.hidden).toBe(true)
  })

  it('leads with the pinned order, across providers rather than within one', () => {
    const rows = rowsFor([snapshot('codex', ['a', 'b']), snapshot('claude', ['c'])], {
      order: [{ model: 'c', providerInstanceId: 'claude' } as never],
    })

    // The settings list is flat, unlike the picker, which groups by provider and
    // so ranks inside each group.
    expect(rows.map((row) => row.ref.model)).toEqual(['c', 'a', 'b'])
  })

  it('keeps a row for a hidden model the provider stopped reporting', () => {
    const rows = rowsFor([snapshot('codex', ['gpt-5-codex'])], {
      hidden: [ref('gpt-4-retired')],
    })

    // Without the row it stays hidden forever with nothing able to bring it back.
    expect(rows.map((row) => row.ref.model)).toEqual(['gpt-5-codex', 'gpt-4-retired'])
    const retired = rows.at(-1)
    expect(retired?.hidden).toBe(true)
    // No snapshot to borrow a label from, so the slug stands in.
    expect(retired?.label).toBe('gpt-4-retired')
    expect(retired?.providerLabel).toBe('codex')
  })
})
