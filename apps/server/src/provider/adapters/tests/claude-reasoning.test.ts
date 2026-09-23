import { describe, expect, it } from 'vitest'
import type {
  ModelSelection,
  ProviderInstanceId,
  ProviderModelCapabilities,
} from '@workspace/contracts'
import { claudeModelCapabilities } from '../utils/claude-models'
import {
  claudePromptText,
  claudeReasoning,
  claudeReasoningKey,
  claudeReasoningQueryOptions,
  effortPlan,
} from '../utils/claude-reasoning'

const CLAUDE_INSTANCE = 'claude' as ProviderInstanceId
const CODEX_INSTANCE = 'codex' as ProviderInstanceId

function modelSelection(overrides: Partial<ModelSelection> = {}): ModelSelection {
  return {
    model: 'claude-opus-5',
    providerInstanceId: CLAUDE_INSTANCE,
    ...overrides,
  }
}

function capabilities(
  efforts: readonly string[],
  defaultEffort = 'high',
): ProviderModelCapabilities {
  return {
    optionDescriptors: [
      {
        id: 'effort',
        label: 'Reasoning',
        type: 'select',
        options: efforts.map((id) => ({
          id,
          label: id,
          ...(id === defaultEffort ? { isDefault: true } : {}),
        })),
        promptInjectedValues: ['ultrathink'],
      },
    ],
  }
}

describe('effortPlan', () => {
  it('resolves the advertised default when no level was chosen', () => {
    expect(
      effortPlan({ capabilities: capabilities(['low', 'high']), requested: undefined }),
    ).toEqual({ effort: 'high' })
    expect(effortPlan({ capabilities: capabilities(['low', 'high']), requested: '  ' })).toEqual({
      effort: 'high',
    })
  })

  it('passes through every level the model advertises', () => {
    const caps = capabilities(['low', 'medium', 'high', 'xhigh', 'max'])

    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(effortPlan({ capabilities: caps, requested: effort })).toEqual({ effort })
    }
  })

  /** The guard: an unadvertised level must degrade, never reach the SDK blind. */
  it('resolves unadvertised xhigh to the descriptor default', () => {
    const caps = capabilities(['low', 'medium', 'high', 'max'])

    expect(effortPlan({ capabilities: caps, requested: 'xhigh' })).toEqual({ effort: 'high' })
  })

  it('falls back to the model default for any other unadvertised level', () => {
    const caps = capabilities(['low', 'medium', 'high'])

    expect(effortPlan({ capabilities: caps, requested: 'ultra' })).toEqual({ effort: 'high' })
    expect(effortPlan({ capabilities: caps, requested: 'xhigh' })).toEqual({ effort: 'high' })
  })

  it('sends nothing at all for a model that advertises nothing', () => {
    expect(effortPlan({ capabilities: null, requested: 'max' })).toEqual({})
    expect(effortPlan({ capabilities: {}, requested: 'max' })).toEqual({})
  })

  /** `ultrathink` has no flag: the turn runs at the default and the prompt carries it. */
  it('turns ultrathink into a prompt prefix at the default level', () => {
    const caps = capabilities(['low', 'high', 'max', 'ultrathink'])

    expect(effortPlan({ capabilities: caps, requested: 'ultrathink' })).toEqual({
      effort: 'high',
      promptPrefix: 'ultrathink',
    })
  })

  /**
   * The hard guarantee: whatever a catalog advertises, only the SDK's own
   * `EffortLevel` union can come out. `ultracode` legitimately becomes `xhigh`;
   * the ids themselves never survive.
   */
  it('never lets a non-SDK level become an effort flag', () => {
    const caps = capabilities(['ultrathink', 'ultracode', 'ultra', 'xhigh'], 'ultra')

    for (const requested of ['ultrathink', 'ultracode', 'ultra', 'hyperdrive']) {
      const { effort } = effortPlan({ capabilities: caps, requested })
      expect(
        effort === undefined || ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort),
      ).toBe(true)
    }
  })

  it('maps ultracode to xhigh plus the session setting', () => {
    const caps = capabilities(['high', 'xhigh', 'ultracode'])

    expect(effortPlan({ capabilities: caps, requested: 'ultracode' })).toEqual({
      effort: 'xhigh',
      ultracode: true,
    })
  })

  it('ignores ultracode and ultrathink on a model that does not advertise them', () => {
    const caps = capabilities(['low', 'medium', 'high'])

    expect(effortPlan({ capabilities: caps, requested: 'ultracode' })).toEqual({ effort: 'high' })
    expect(effortPlan({ capabilities: caps, requested: 'ultrathink' })).toEqual({ effort: 'high' })
  })
})

describe('claudeReasoning', () => {
  it.each([
    ['claude-opus-5', 'high'],
    ['claude-fable-5-1', 'medium'],
    ['claude-sonnet-5', 'high'],
    ['', 'medium'],
  ])('resolves %s default effort without an explicit selection', (model, effort) => {
    expect(
      claudeReasoning({
        modelSelection: modelSelection({ model }),
        providerInstanceId: CLAUDE_INSTANCE,
      }),
    ).toEqual({ effort })
  })

  it('ignores a thinking toggle for a known model that only advertises effort', () => {
    expect(
      claudeReasoning({
        modelSelection: modelSelection({ options: { thinking: true } }),
        providerInstanceId: CLAUDE_INSTANCE,
      }),
    ).toEqual({ effort: 'high' })
  })

  it('reads the effort out of the per-session selection', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({ options: { effort: 'max' } }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({ effort: 'max' })
  })

  it('ignores a selection aimed at another provider', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({
        options: { effort: 'max' },
        providerInstanceId: CODEX_INSTANCE,
      }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({})
  })

  it('resolves the [1m] slug against the base model capabilities', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({
        model: 'claude-opus-5[1m]',
        options: { effort: 'xhigh' },
      }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({ effort: 'xhigh' })
  })

  it('sends no effort for a model outside the catalog', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({
        model: 'claude-next-9',
        options: { effort: 'max' },
      }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({})
  })

  it('enables the advertised Haiku thinking setting', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({ model: 'claude-haiku-4-5', options: { thinking: true } }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({
      settings: { alwaysThinkingEnabled: true },
    })
  })

  it('disables thinking on both sides at once', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({ model: 'claude-haiku-4-5', options: { thinking: false } }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({
      settings: { alwaysThinkingEnabled: false },
    })
  })

  it('ignores a thinking selection on a model that does not support it', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({ model: 'claude-next-9', options: { thinking: true } }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({})
  })

  it.each([
    ['claude-opus-5', true, { effort: 'high', settings: { fastMode: true } }],
    ['claude-opus-5', false, { effort: 'high' }],
    ['claude-fable-5', true, { effort: 'medium' }],
    ['claude-sonnet-5', true, { effort: 'high' }],
  ])('gates fast mode on the %s descriptor (%s)', (model, fastMode, expected) => {
    expect(
      claudeReasoning({
        modelSelection: modelSelection({ model, options: { fastMode } }),
        providerInstanceId: CLAUDE_INSTANCE,
      }),
    ).toEqual(expected)
  })

  it('carries ultracode through as a session setting, never as a level', () => {
    const reasoning = claudeReasoning({
      modelSelection: modelSelection({ options: { effort: 'ultracode' } }),
      providerInstanceId: CLAUDE_INSTANCE,
    })

    expect(reasoning).toEqual({ effort: 'xhigh', settings: { ultracode: true } })
  })
})

describe('claudeReasoningQueryOptions', () => {
  it('emits no reasoning keys for an empty plan', () => {
    const options = claudeReasoningQueryOptions({})

    expect('effort' in options).toBe(false)
    expect('settings' in options).toBe(false)
    expect('thinking' in options).toBe(false)
  })

  /** `promptPrefix` is ours; leaking it into the SDK options would be a silent no-op. */
  it('never forwards the prompt prefix to the SDK', () => {
    const options = claudeReasoningQueryOptions({ effort: 'high', promptPrefix: 'ultrathink' })

    expect(options).toEqual({ effort: 'high' })
  })
})

describe('claudeReasoningKey', () => {
  it('separates plans that must not share a session', () => {
    const keys = [
      claudeReasoningKey({}),
      claudeReasoningKey({ effort: 'high' }),
      claudeReasoningKey({ effort: 'max' }),
      claudeReasoningKey({ effort: 'high', settings: { fastMode: true } }),
      claudeReasoningKey({ effort: 'high', promptPrefix: 'ultrathink' }),
      claudeReasoningKey({ effort: 'xhigh', settings: { ultracode: true } }),
      claudeReasoningKey({ settings: { alwaysThinkingEnabled: true } }),
      claudeReasoningKey({ settings: { alwaysThinkingEnabled: false } }),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('matches for two identical plans', () => {
    expect(claudeReasoningKey({ effort: 'max' })).toBe(claudeReasoningKey({ effort: 'max' }))
  })
})

describe('claudePromptText', () => {
  it('leaves the text alone without the ultrathink prefix', () => {
    expect(claudePromptText('  Investigate  ', { effort: 'max' })).toBe('  Investigate  ')
  })

  it('prefixes an ultrathink turn', () => {
    expect(claudePromptText('Investigate the edge cases', { promptPrefix: 'ultrathink' })).toBe(
      'Ultrathink:\nInvestigate the edge cases',
    )
  })

  it('does not double-prefix', () => {
    expect(claudePromptText('Ultrathink:\nAgain', { promptPrefix: 'ultrathink' })).toBe(
      'Ultrathink:\nAgain',
    )
  })

  it('leaves an empty message empty', () => {
    expect(claudePromptText('', { promptPrefix: 'ultrathink' })).toBe('')
  })
})

describe('claudeModelCapabilities', () => {
  it.each([
    ['claude-opus-5', 'high', '1m'],
    ['claude-opus-5[1m]', 'high', '1m'],
    ['claude-fable-5', 'medium', '1m'],
    ['claude-fable-5-1', 'medium', '1m'],
    ['claude-sonnet-5', 'high', '200k'],
  ])('advertises the pinned defaults for %s', (slug, effort, context) => {
    const descriptors = claudeModelCapabilities(slug)?.optionDescriptors
    const choices = descriptors?.flatMap((descriptor) =>
      descriptor.type === 'select'
        ? descriptor.options
            .filter((choice) => choice.isDefault)
            .map((choice) => [descriptor.id, choice.id])
        : [],
    )
    expect(choices).toEqual([
      ['effort', effort],
      ['contextWindow', context],
    ])
  })

  it('offers ultracode only on Opus and Fable', () => {
    const hasUltracode = (slug: string) =>
      claudeModelCapabilities(slug)?.optionDescriptors?.some(
        (descriptor) =>
          descriptor.type === 'select' &&
          descriptor.options.some((choice) => choice.id === 'ultracode'),
      )
    expect(hasUltracode('claude-opus-5')).toBe(true)
    expect(hasUltracode('claude-fable-5')).toBe(true)
    expect(hasUltracode('claude-sonnet-5')).toBe(false)
  })

  it('advertises only thinking for Haiku and no capabilities for an unknown model', () => {
    expect(claudeModelCapabilities('claude-haiku-4-5')).toEqual({
      optionDescriptors: [{ id: 'thinking', label: 'Thinking', type: 'boolean' }],
    })
    expect(claudeModelCapabilities('claude-next-9')).toBeNull()
  })
})
