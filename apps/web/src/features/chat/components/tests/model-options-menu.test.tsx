import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { DEFAULT_PROVIDER_INSTANCE_ID, type ModelSelection } from '@workspace/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ModelOptionsMenu } from '@/features/chat/components/model-options-menu'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { ChatModelPickerProvider } from '@/features/chat/providers/model-picker-provider'
import { writeProviderDisplayCache } from '@/features/chat/state/provider-display-cache'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { getClient, setClient } from '@/lib/client'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createObservedInProcessClient } from '../../../../../test/client'
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

test.for([
  { name: 'wide', compact: false, hasCapabilities: true },
  { name: 'compact', compact: true, hasCapabilities: true },
  { name: 'unsupported', compact: true, hasCapabilities: false },
])(
  'the $name model options control restores its cached summary before providers load',
  async ({ compact, hasCapabilities }, { server }) => {
    resetChatInputDraftStore()
    localStorage.clear()
    writeProviderDisplayCache(environmentScopedStorage(FIXTURE_ENVIRONMENT_ID), [
      providerSnapshot({
        models: [
          providerModel({
            capabilities: hasCapabilities
              ? {
                  defaultReasoningEffort: 'high',
                  reasoningEfforts: [{ effort: 'high' }, { effort: 'max' }],
                  supportsExtendedThinking: true,
                }
              : null,
          }),
        ],
      }),
    ])
    const release = Promise.withResolvers<void>()
    const previousClient = getClient()
    setClient(
      createObservedInProcessClient(server, (request) => {
        if (new URL(request.url).pathname === '/providers') return release.promise
      }),
    )
    const queryClient = createTestQueryClient()
    const queryKey = providerListQueryOptions().queryKey
    const view = renderWithProviders(
      <ChatModelPickerProvider
        draftTarget={draftTarget}
        sessionProviderInstanceId={DEFAULT_PROVIDER_INSTANCE_ID}
        modelSelection={{
          model: 'gpt-5.5',
          options: { reasoningEffort: 'max', thinking: true },
          providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
        }}
        persistModelSelection={() => {}}
      >
        <ModelOptionsMenu compact={compact} disabled={false} draftTarget={draftTarget} />
      </ChatModelPickerProvider>,
      { queryClient },
    )

    try {
      expect(queryClient.getQueryState(queryKey)?.status).toBe('pending')
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()
      const trigger = screen.queryByRole('button', { name: 'Model options' })
      if (hasCapabilities) {
        const control = screen.getByRole('button', { name: 'Model options' })
        expect(control).not.toHaveAttribute('title')
        await userEvent.hover(control)
        expect(await screen.findByText('Model options: Max · On')).toBeVisible()
      }
      if (!hasCapabilities) expect(trigger).toBeNull()
      if (hasCapabilities && !compact) expect(trigger).toHaveTextContent('Max · On')

      release.resolve()

      await waitFor(() => {
        expect(queryClient.getQueryState(queryKey)?.status).toBe('success')
        expect(screen.queryByRole('button', { name: 'Model options' })).toBeNull()
      })
    } finally {
      release.resolve()
      view.unmount()
      await queryClient.cancelQueries()
      queryClient.clear()
      setClient(previousClient)
      localStorage.clear()
    }
  },
)

function draftModelSelection() {
  return useChatInputDraftStore.getState().getDraft(draftTarget).modelSelection
}

function renderMenu({
  options,
  ...model
}: Partial<Parameters<typeof providerModel>[0]> & {
  options?: ModelSelection['options']
} = {}) {
  resetChatInputDraftStore()
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
              defaultReasoningEffort: 'high',
              reasoningEfforts: [{ effort: 'high' }, { effort: 'max' }],
              supportsExtendedThinking: true,
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
