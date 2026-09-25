import { providerInstanceIdSchema, type ProviderSnapshot } from '@workspace/contracts'
import * as v from 'valibot'
import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import { modelSwitchLabel } from '@/features/chat/utils/model-switch'

const provider = {
  models: [
    {
      capabilities: {
        optionDescriptors: [
          {
            id: 'reasoningEffort',
            label: 'Reasoning',
            type: 'select',
            options: [
              { id: 'high', label: 'High', isDefault: true },
              { id: 'xhigh', label: 'Extra high' },
            ],
          },
        ],
      },
      isCustom: false,
      name: 'GPT-5.2',
      slug: 'gpt-5.2',
    },
  ],
} as unknown as ProviderSnapshot
const selection = {
  model: 'gpt-5.2',
  options: { reasoningEffort: 'xhigh' },
  providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
}

describe('model switch label', () => {
  it('names the model and effort in the picker words', () => {
    expect(modelSwitchLabel('switched', provider, selection)).toBe(
      'Switched to GPT-5.2 · Extra high',
    )
  })

  it('names only the model for a reroute, and the slug when the catalog lacks it', () => {
    expect(modelSwitchLabel('rerouted', provider, selection)).toBe('Rerouted to GPT-5.2')
    expect(modelSwitchLabel('switched', undefined, selection)).toBe('Switched to gpt-5.2')
  })
})
