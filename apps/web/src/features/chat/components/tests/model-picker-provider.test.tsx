import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Button } from '@workspace/ui/components/button'
import { DEFAULT_PROVIDER_INSTANCE_ID, type ModelSelection } from '@workspace/contracts'
import {
  providerModelOptions,
  type ProviderModelOption,
} from '@workspace/client-core/chat/providers/models'
import { ChatModelPickerProvider } from '../../providers/model-picker-provider'
import { useModelPicker } from '../../hooks/use-model-picker'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '../../state/chat-input-draft-store'
import { providerListQueryOptions } from '@/lib/provider-query'
import {
  providerModel,
  providerSnapshot,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const target = { environmentId: TEST_ENVIRONMENT_ID, draftKey: 'model-switch', rootPath: '/repo' }

test('switching model drops unsupported options and adopts advertised defaults while retaining valid false', async () => {
  resetChatInputDraftStore()
  const previous: ModelSelection = {
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    model: 'old',
    options: {
      reasoningEffort: 'old-effort',
      serviceTier: 'old-tier',
      contextWindow: '1m',
      thinking: false,
    },
  }
  useChatInputDraftStore.getState().setModelSelection(target, previous)
  const provider = providerSnapshot({
    models: [
      providerModel({
        slug: 'new',
        capabilities: {
          optionDescriptors: [
            {
              id: 'reasoningEffort',
              label: 'Reasoning',
              type: 'select',
              options: [{ id: 'future-effort', label: 'Future reasoning', isDefault: true }],
            },
            {
              id: 'serviceTier',
              label: 'Service tier',
              type: 'select',
              currentValue: 'economy-v2',
              options: [
                { id: 'default', label: 'Standard' },
                { id: 'economy-v2', label: 'Economy', isDefault: true },
              ],
            },
            { id: 'thinking', label: 'Thinking', type: 'boolean', currentValue: true },
          ],
        },
      }),
    ],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, { providers: [provider] })
  const option = providerModelOptions([provider])[0]!
  const persist = vi.fn()
  renderWithProviders(
    <ChatModelPickerProvider
      draftTarget={target}
      sessionProviderInstanceId={DEFAULT_PROVIDER_INSTANCE_ID}
      modelSelection={previous}
      persistModelSelection={persist}
    >
      <PickModel option={option} />
    </ChatModelPickerProvider>,
    { queryClient },
  )
  await userEvent.click(screen.getByRole('button', { name: 'Pick new model' }))
  const expected = {
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    model: 'new',
    options: { reasoningEffort: 'future-effort', serviceTier: 'economy-v2', thinking: false },
  }
  expect(useChatInputDraftStore.getState().getDraft(target).modelSelection).toEqual(expected)
  expect(persist).toHaveBeenCalledExactlyOnceWith(expected)
})

function PickModel({ option }: { option: ProviderModelOption }) {
  const picker = useModelPicker()
  return <Button onClick={() => picker.selectModel(option)}>Pick new model</Button>
}
