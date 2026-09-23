import { describe, expect, it } from 'vitest'
import type { ProviderModelCapabilities } from '@workspace/contracts'

import { MockProviderAdapter } from '../../provider/adapters/mock'
import { commitMessageCandidates, selectCommitMessageModel } from '../commit-message-generator'

describe('commit message model selection', () => {
  it.each(['effort', 'reasoningEffort'])(
    'uses the advertised %s option for low-cost generation',
    async (id) => {
      const provider = await providerSnapshot([
        {
          name: 'Claude Sonnet 5',
          shortName: 'Sonnet 5',
          slug: 'claude-sonnet-5',
          capabilities: {
            optionDescriptors: [
              {
                id,
                label: 'Effort',
                type: 'select',
                options: [
                  { id: 'low', label: 'Low' },
                  { id: 'high', label: 'High', isDefault: true },
                ],
              },
            ],
          },
        },
      ])

      expect(selectCommitMessageModel([provider])?.modelSelection.options).toEqual({ [id]: 'low' })
    },
  )

  it('uses only advertised cheap fallbacks instead of an arbitrary expensive model', async () => {
    const expensive = await providerSnapshot([
      { name: 'Claude Opus 5', shortName: 'Opus', slug: 'claude-opus-5' },
    ])
    const fable = await providerSnapshot([
      { name: 'GPT-5.6 Fable', shortName: 'Fable', slug: 'gpt-5.6-fable' },
    ])
    const nonChatGptLuna = await providerSnapshot([
      { name: 'GPT-5.6 Luna', shortName: 'Luna', slug: 'gpt-5.6-luna' },
    ])
    const cheap = await providerSnapshot([
      { name: 'Claude Opus 5', shortName: 'Opus', slug: 'claude-opus-5' },
      { name: 'Claude Haiku 5', shortName: 'Haiku', slug: 'claude-haiku-5' },
    ])

    expect(selectCommitMessageModel([expensive])).toBeNull()
    expect(selectCommitMessageModel([fable])).toBeNull()
    expect(selectCommitMessageModel([nonChatGptLuna])).toBeNull()
    expect(selectCommitMessageModel([cheap])?.modelSelection).toMatchObject({
      model: 'claude-haiku-5',
    })
  })

  it('offers one cheap model per ready provider, so a failing provider has a successor', async () => {
    const claude = await providerSnapshot([
      { name: 'Claude Opus 5', shortName: 'Opus', slug: 'claude-opus-5' },
      { name: 'Claude Haiku 5', shortName: 'Haiku', slug: 'claude-haiku-5' },
    ])
    const gemini = await providerSnapshot([
      { name: 'Gemini Flash', shortName: 'Flash', slug: 'gemini-flash' },
    ])

    const models = commitMessageCandidates([claude, gemini]).map(
      (candidate) => candidate.modelSelection.model,
    )

    expect(models).toEqual(['claude-haiku-5', 'gemini-flash'])
  })

  it('settles for Sonnet when a provider advertises nothing cheaper, and never for Opus', async () => {
    const claude = await providerSnapshot([
      { name: 'Claude Opus 5', shortName: 'Opus 5', slug: 'claude-opus-5' },
      { name: 'Claude Sonnet 5', shortName: 'Sonnet 5', slug: 'claude-sonnet-5' },
    ])

    expect(selectCommitMessageModel([claude])?.modelSelection.model).toBe('claude-sonnet-5')
  })
})

async function providerSnapshot(
  models: Array<{
    name: string
    shortName: string
    slug: string
    capabilities?: ProviderModelCapabilities
  }>,
) {
  const adapter = new MockProviderAdapter({
    auth: { status: 'authenticated', type: 'api-key' },
    models: models.map((model) => ({ capabilities: null, isCustom: false, ...model })),
  })

  return adapter.snapshot()
}
