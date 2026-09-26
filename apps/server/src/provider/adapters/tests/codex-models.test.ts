import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { CodexModelSchema } from '../codex-protocol'
import { codexModelCapabilities } from '../utils/codex-models'

function model(overrides: Record<string, unknown> = {}) {
  return v.parse(CodexModelSchema, {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: '',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'future-effort-v3', description: 'A newly advertised effort' },
    ],
    ...overrides,
  })
}

describe('codexModelCapabilities', () => {
  it('retains advertised future effort and tier IDs, labels, descriptions and defaults', () => {
    expect(
      codexModelCapabilities(
        model({
          serviceTiers: [
            { id: 'priority', name: 'Priority', description: 'Faster processing' },
            { id: 'economy-v2', name: 'Economy v2', description: '' },
          ],
          defaultServiceTier: 'economy-v2',
          additionalSpeedTiers: ['fast'],
        }),
      ),
    ).toEqual({
      optionDescriptors: [
        {
          id: 'reasoningEffort',
          label: 'Reasoning',
          type: 'select',
          currentValue: 'medium',
          options: [
            { id: 'medium', label: 'Medium', description: 'Balanced', isDefault: true },
            {
              id: 'future-effort-v3',
              label: 'future-effort-v3',
              description: 'A newly advertised effort',
            },
          ],
        },
        {
          id: 'serviceTier',
          label: 'Service tier',
          type: 'select',
          currentValue: 'economy-v2',
          options: [
            { id: 'default', label: 'Standard' },
            { id: 'priority', label: 'Priority', description: 'Faster processing' },
            { id: 'economy-v2', label: 'Economy v2', isDefault: true },
          ],
        },
      ],
    })
  })

  it.each([undefined, 'unadvertised'])(
    'uses Standard when the native default %s is absent from choices',
    (defaultServiceTier) => {
      const caps = codexModelCapabilities(
        model({
          serviceTiers: [{ id: 'flex', name: 'Flexible', description: '' }],
          defaultServiceTier,
        }),
      )
      expect(caps?.optionDescriptors?.[1]).toMatchObject({
        currentValue: 'default',
        options: [
          { id: 'default', label: 'Standard', isDefault: true },
          { id: 'flex', label: 'Flexible' },
        ],
      })
    },
  )

  it.each([undefined, [], [{ id: ' ', name: 'Blank', description: '' }]])(
    'falls back to speed tiers without usable service tiers (%j)',
    (serviceTiers) => {
      const caps = codexModelCapabilities(
        model({ serviceTiers, additionalSpeedTiers: ['fast', 'flex'] }),
      )
      expect(caps?.optionDescriptors?.[1]).toMatchObject({
        options: [
          { id: 'default', label: 'Standard', isDefault: true },
          { id: 'fast', label: 'Fast' },
          { id: 'flex', label: 'flex' },
        ],
      })
    },
  )

  it('keeps tiers on a model without reasoning choices and omits empty capabilities', () => {
    expect(
      codexModelCapabilities(
        model({ supportedReasoningEfforts: [], additionalSpeedTiers: ['fast'] }),
      )?.optionDescriptors,
    ).toHaveLength(1)
    expect(codexModelCapabilities(model({ supportedReasoningEfforts: [] }))).toBeNull()
  })

  it.each(['gpt-6-astra', 'openai.gpt-6-astra'])(
    'uses the pinned medium default for %s',
    (slug) => {
      expect(
        codexModelCapabilities(model({ model: slug, defaultReasoningEffort: 'future-effort-v3' }))
          ?.optionDescriptors?.[0],
      ).toMatchObject({ currentValue: 'medium' })
    },
  )

  it('omits an unsupported default and drops blank effort IDs', () => {
    const caps = codexModelCapabilities(
      model({
        defaultReasoningEffort: 'unsupported',
        supportedReasoningEfforts: [
          { reasoningEffort: ' ', description: 'blank' },
          { reasoningEffort: ' future-v4 ', description: ' ' },
        ],
      }),
    )
    expect(caps).toEqual({
      optionDescriptors: [
        {
          id: 'reasoningEffort',
          label: 'Reasoning',
          type: 'select',
          options: [{ id: 'future-v4', label: 'future-v4' }],
        },
      ],
    })
  })
})
