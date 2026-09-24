import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderModel } from '@workspace/contracts'
import { assert, describe, expect, it } from 'vitest'
import {
  claudeModelRows,
  SYNTHETIC_FABLE,
  SYNTHETIC_HAIKU,
  SYNTHETIC_OPUS,
  SYNTHETIC_SONNET,
} from '../../../../test/factories/claude-models'
import {
  claudeCatalog,
  claudeModelCapabilities,
  claudeModelName,
  DEFAULT_CLAUDE_MODEL,
} from '../utils/claude-models'

function current(models: readonly ProviderModel[]) {
  return models.filter((model) => model.status === 'current').map((model) => model.slug)
}

function legacy(models: readonly ProviderModel[]) {
  return models.filter((model) => model.status === 'legacy').map((model) => model.slug)
}

function model(models: readonly ProviderModel[], slug: string) {
  const found = models.find((entry) => entry.slug === slug)
  assert(found, `no ${slug} in catalog`)
  return found
}

function defaults(entry: ProviderModel) {
  return (entry.capabilities?.optionDescriptors ?? []).flatMap((descriptor) =>
    descriptor.type === 'select'
      ? descriptor.options
          .filter((choice) => choice.isDefault)
          .map((choice) => [descriptor.id, choice.id])
      : [[descriptor.id, descriptor.type]],
  )
}

function effortIds(entry: ProviderModel) {
  const effort = entry.capabilities?.optionDescriptors?.find(
    (descriptor) => descriptor.id === 'effort',
  )
  return effort?.type === 'select' ? effort.options.map((choice) => choice.id) : []
}

function row(value: string, resolvedModel?: string): ModelInfo {
  return {
    value,
    ...(resolvedModel ? { resolvedModel } : {}),
    displayName: value,
    description: '',
    supportedEffortLevels: ['low', 'high'],
  }
}

describe('claudeCatalog', () => {
  const catalog = claudeCatalog(claudeModelRows())

  it('lists concrete slugs, drops the default row, and strips window and date suffixes', () => {
    expect(current(catalog.models)).toEqual([
      SYNTHETIC_OPUS,
      SYNTHETIC_FABLE,
      SYNTHETIC_SONNET,
      SYNTHETIC_HAIKU,
    ])
  })

  it('names models from the slug, not the generic display name', () => {
    expect(model(catalog.models, SYNTHETIC_FABLE)).toMatchObject({
      name: 'Claude Fable 9.1',
      shortName: 'Fable 9.1',
    })
    expect(model(catalog.models, SYNTHETIC_HAIKU).name).toBe('Claude Haiku 9.9')
  })

  it('folds a [1m] row into a context window that defaults to 1M', () => {
    expect(defaults(model(catalog.models, SYNTHETIC_OPUS))).toContainEqual(['contextWindow', '1m'])
    expect(defaults(model(catalog.models, SYNTHETIC_FABLE))).toContainEqual(['contextWindow', '1m'])
  })

  it('reads effort levels and fast mode from the rows and defaults from the family overlay', () => {
    expect(defaults(model(catalog.models, SYNTHETIC_OPUS))).toEqual([
      ['effort', 'high'],
      ['fastMode', 'boolean'],
      ['contextWindow', '1m'],
    ])
    expect(defaults(model(catalog.models, SYNTHETIC_FABLE))).toEqual([
      ['effort', 'medium'],
      ['contextWindow', '1m'],
    ])
    expect(defaults(model(catalog.models, SYNTHETIC_SONNET))).toEqual([
      ['effort', 'high'],
      ['contextWindow', '200k'],
    ])
    expect(defaults(model(catalog.models, SYNTHETIC_HAIKU))).toEqual([['thinking', 'boolean']])
  })

  it('adds ultracode where the family carries it and ultrathink to every effort model', () => {
    expect(effortIds(model(catalog.models, SYNTHETIC_OPUS))).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
      'ultrathink',
    ])
    expect(effortIds(model(catalog.models, SYNTHETIC_SONNET))).not.toContain('ultracode')
    expect(effortIds(model(catalog.models, SYNTHETIC_SONNET))).toContain('ultrathink')
  })

  it('merges rows that resolve to one slug', () => {
    const merged = claudeCatalog([
      row('opus', SYNTHETIC_OPUS),
      { ...row('opus[1m]', `${SYNTHETIC_OPUS}[1m]`), supportedEffortLevels: ['max'] },
    ])

    expect(current(merged.models)).toEqual([SYNTHETIC_OPUS])
    expect(effortIds(model(merged.models, SYNTHETIC_OPUS))).toEqual([
      'low',
      'high',
      'max',
      'ultracode',
      'ultrathink',
    ])
    expect(defaults(model(merged.models, SYNTHETIC_OPUS))).toContainEqual(['contextWindow', '1m'])
  })

  it('gives an unknown family its levels with no default and no ultracode', () => {
    const unknown = claudeCatalog([row('claude-nova-1')])

    expect(effortIds(model(unknown.models, 'claude-nova-1'))).toEqual(['low', 'high', 'ultrathink'])
    expect(defaults(model(unknown.models, 'claude-nova-1'))).toEqual([])
  })

  it('appends retired models as legacy after every current one', () => {
    const retired = legacy(catalog.models)

    expect(retired.length).toBeGreaterThan(0)
    expect(catalog.models.slice(-retired.length).map((entry) => entry.slug)).toEqual(retired)
  })

  it('lists a legacy model the CLI lists again once, as current', () => {
    const [retired] = legacy(catalog.models)
    const relisted = claudeCatalog([...claudeModelRows(), row(retired ?? '')])

    expect(current(relisted.models)).toContain(retired)
    expect(legacy(relisted.models)).not.toContain(retired)
  })

  it('lists nothing when the CLI listed nothing', () => {
    expect(claudeCatalog([]).models).toEqual([])
    expect(claudeCatalog([row('default', SYNTHETIC_OPUS)]).models).toEqual([])
  })
})

describe('claudeCatalog default', () => {
  it('keeps the product default first when the CLI lists it', () => {
    const catalog = claudeCatalog([
      ...claudeModelRows(),
      row(`${DEFAULT_CLAUDE_MODEL}[1m]`, DEFAULT_CLAUDE_MODEL),
    ])

    expect(catalog.defaultModel).toBe(DEFAULT_CLAUDE_MODEL)
    expect(catalog.defaultFallback).toBe(false)
    expect(catalog.models[0]?.slug).toBe(DEFAULT_CLAUDE_MODEL)
  })

  it("falls back to the CLI's default row when the product default is not listed", () => {
    const catalog = claudeCatalog(claudeModelRows())

    expect(catalog.defaultModel).toBe(SYNTHETIC_OPUS)
    expect(catalog.defaultFallback).toBe(true)
    expect(catalog.models[0]?.slug).toBe(SYNTHETIC_OPUS)
  })
})

describe('claudeModelCapabilities', () => {
  const { models } = claudeCatalog(claudeModelRows())

  it('resolves a [1m] or dated id against its slug', () => {
    const base = claudeModelCapabilities(models, SYNTHETIC_OPUS)

    expect(base).not.toBeNull()
    expect(claudeModelCapabilities(models, `${SYNTHETIC_OPUS}[1m]`)).toBe(base)
    expect(claudeModelCapabilities(models, `${SYNTHETIC_HAIKU}-20990101`)).not.toBeNull()
  })

  it('has nothing for a model outside the catalog', () => {
    expect(claudeModelCapabilities(models, 'claude-next-9')).toBeNull()
  })
})

describe('claudeModelName', () => {
  it.each([
    ['claude-opus-9-5', 'Claude Opus 9.5'],
    ['claude-sonnet-9', 'Claude Sonnet 9'],
    ['claude-9-5-sonnet', 'Claude 9.5 Sonnet'],
  ])('names %s as %s', (slug, name) => {
    expect(claudeModelName(slug)).toBe(name)
  })
})
