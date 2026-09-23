import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  type ModelSelection,
  type ProviderOptionDescriptor,
} from '@workspace/contracts'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ModelOptionsMenu } from '@/features/chat/components/model-options-menu'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { ChatModelPickerProvider } from '@/features/chat/providers/model-picker-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { providerModel, providerSnapshot } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const draftTarget: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: 'a5dc7509-a238-536c-9fbb-16f29f69dd82',
  rootPath: '/repo/platform',
}
const modelSelection: ModelSelection = {
  model: 'claude-opus-5',
  providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
}

test('every option the model advertises gets a control, not just the effort ladder', async () => {
  renderMenu()

  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))

  expect(await screen.findByRole('menuitemradio', { name: 'High' })).toBeVisible()
  // Extended thinking was advertised long before anything could act on it.
  expect(await screen.findByRole('menuitemradio', { name: 'On' })).toBeVisible()
})

test('a boolean option persists as a boolean, which is what the adapter reads', async () => {
  renderMenu()

  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'On' }))

  expect(draftModelSelection()?.options).toEqual({ thinking: true })
})

test('a select option persists under its own key', async () => {
  renderMenu()

  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Max' }))

  expect(draftModelSelection()?.options).toEqual({ reasoningEffort: 'max' })
  expect(screen.queryByRole('menu')).toBeNull()
})

test('a stored value comes back as the checked row, each descriptor on its own', async () => {
  renderMenu({ options: { reasoningEffort: 'max' } })

  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))

  const checked = await screen.findAllByRole('menuitemradio', { checked: true })
  expect(checked.map((item) => item.textContent)).toEqual(['Max', 'Provider default'])
})

test('clearing an option hands the knob back to the provider', async () => {
  renderMenu({ options: { reasoningEffort: 'max' } })

  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  await userEvent.click(
    await screen.findByRole('menuitemradio', { name: /Provider default \(High\)/ }),
  )

  expect(draftModelSelection()).toEqual(modelSelection)
})

test('a model that advertises nothing shows no control at all', () => {
  renderMenu({ capabilities: null })

  expect(screen.queryByRole('button', { name: 'Model options' })).toBeNull()
})

test('advertised service tiers retain exact provider IDs and descriptions', async () => {
  renderMenu({
    capabilities: {
      optionDescriptors: [
        {
          id: 'serviceTier',
          label: 'Service tier',
          type: 'select',
          currentValue: 'default',
          options: [
            { id: 'default', label: 'Standard', isDefault: true },
            {
              id: 'priority-v2',
              label: 'Express',
              description: 'Faster processing with priority capacity.',
            },
            {
              id: 'flex-night',
              label: 'Economy',
              description: 'Lower cost when capacity is available.',
            },
          ],
        },
      ],
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Standard' })).toBeVisible()
  expect(screen.getByText('Lower cost when capacity is available.')).toBeVisible()
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Express' }))
  expect(draftModelSelection()?.options).toEqual({ serviceTier: 'priority-v2' })
})

test('future reasoning IDs round-trip from the provider descriptor without a local enum', async () => {
  renderMenu({
    capabilities: {
      optionDescriptors: [
        {
          id: 'reasoningEffort',
          label: 'Reasoning',
          type: 'select',
          options: [{ id: 'hyperdrive-v3', label: 'Deep analysis' }],
        },
      ],
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Deep analysis' }))
  expect(draftModelSelection()?.options).toEqual({ reasoningEffort: 'hyperdrive-v3' })
})

test('an explicit false remains distinct from an advertised true default', async () => {
  renderMenu({
    options: { thinking: false },
    capabilities: {
      optionDescriptors: [
        { id: 'thinking', label: 'Thinking', type: 'boolean', currentValue: true },
      ],
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Off' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Provider default (On)' }))
  expect(draftModelSelection()).toEqual(modelSelection)
})

const promptDescriptors: ProviderOptionDescriptor[] = [
  {
    id: 'effort',
    label: 'Reasoning',
    type: 'select',
    currentValue: 'high',
    options: [
      { id: 'high', label: 'High', isDefault: true },
      { id: 'max', label: 'Max' },
      { id: 'ultrathink', label: 'Ultrathink' },
    ],
    promptInjectedValues: ['ultrathink'],
  },
  { id: 'fastMode', label: 'Fast mode', type: 'boolean' },
]

test.each([
  ['', 'Ultrathink:\n'],
  ['  Explain the code  ', 'Ultrathink:\nExplain the code'],
  ['/deploy.prod staging', '/deploy.prod staging'],
  ['/home/theo/app.ts', 'Ultrathink:\n/home/theo/app.ts'],
])(
  'prompt-injected effort updates %j without persisting a native override',
  async (prompt, expected) => {
    renderMenu({
      prompt,
      options: { effort: 'max', fastMode: false },
      capabilities: { optionDescriptors: promptDescriptors },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Ultrathink' }))

    expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe(expected)
    expect(draftModelSelection()?.options).toEqual({ effort: 'max', fastMode: false })
  },
)

test('regular effort removes an injected prefix and restores its selected native value', async () => {
  renderMenu({
    prompt: 'Ultrathink:\nExplain the code',
    capabilities: { optionDescriptors: promptDescriptors },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Ultrathink' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Max' }))

  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe('Explain the code')
  expect(draftModelSelection()?.options).toEqual({ effort: 'max' })
})

test('body-controlled effort cannot be changed by a menu while other traits remain usable', async () => {
  renderMenu({
    prompt: 'Please ultrathink about this',
    capabilities: { optionDescriptors: promptDescriptors },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Model options' }))
  expect(screen.getByText(/Remove it from the text to change this option/)).toBeVisible()
  expect(await screen.findByRole('menuitemradio', { name: 'Max' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByRole('menuitemradio', { name: 'Ultrathink' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'On' }))

  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe(
    'Please ultrathink about this',
  )
  expect(draftModelSelection()?.options).toEqual({ fastMode: true })
})

function draftModelSelection() {
  return useChatInputDraftStore.getState().getDraft(draftTarget).modelSelection
}

function renderMenu({
  options,
  prompt = '',
  ...model
}: Partial<Parameters<typeof providerModel>[0]> & {
  options?: ModelSelection['options']
  prompt?: string
} = {}) {
  resetChatInputDraftStore()
  useChatInputDraftStore.getState().setPrompt(draftTarget, prompt)
  if (options) {
    useChatInputDraftStore.getState().setModelSelection(draftTarget, { ...modelSelection, options })
  }

  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, {
    providers: [
      providerSnapshot({
        models: [
          providerModel({
            capabilities: {
              optionDescriptors: [
                {
                  id: 'reasoningEffort',
                  label: 'Reasoning',
                  type: 'select',
                  currentValue: 'high',
                  options: [
                    { id: 'high', label: 'High', isDefault: true },
                    { id: 'max', label: 'Max' },
                  ],
                },
                { id: 'thinking', label: 'Extended thinking', type: 'boolean' },
              ],
            },
            name: 'Claude Opus 5',
            slug: 'claude-opus-5',
            ...model,
          }),
        ],
      }),
    ],
  })

  renderWithProviders(
    <ChatModelPickerProvider
      draftTarget={draftTarget}
      sessionProviderInstanceId={DEFAULT_PROVIDER_INSTANCE_ID}
      modelSelection={modelSelection}
      persistModelSelection={() => {}}
    >
      <ModelOptionsMenu compact={false} disabled={false} draftTarget={draftTarget} />
    </ChatModelPickerProvider>,
    { queryClient },
  )
}
