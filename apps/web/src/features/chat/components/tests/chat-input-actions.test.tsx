import { initializePromptStashStore } from '@/features/chat/state/prompt-stash-store'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { sessionIdSchema, type ClientOrchestrationCommand } from '@workspace/contracts'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_PROVIDER_INSTANCE_ID, providerInstanceIdSchema } from '@workspace/contracts'
import { providerModel, providerSnapshot } from '../../../../../test/factories/chat'
import * as v from 'valibot'
import { afterEach, beforeEach } from 'vitest'

import { ChatInputActions } from '@/features/chat/components/chat-input-actions'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { ChatComposerModesProvider } from '@/features/chat/providers/composer-modes-provider'
import { ChatModelPickerProvider } from '@/features/chat/providers/model-picker-provider'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const sessionId = v.parse(sessionIdSchema, 'd587e342-74d2-5b84-b545-b7a49b2bae30')
const draftTarget: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: sessionId,
  rootPath: '/repo/platform',
}
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

let measuredWidth = 800

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return measuredWidth
    },
  })
})

afterEach(() => {
  if (!clientWidthDescriptor) return

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
})

test('a wide composer keeps the status on the control row', () => {
  measuredWidth = 800
  const { container } = renderActions()

  const row = actionsRow(container)
  expect(row).toHaveAttribute('data-compact', 'false')
  // One line: the status shares the row with the controls.
  expect(row?.childElementCount).toBe(1)
  expect(screen.getByTitle('Working')).toBeVisible()
})

test('a narrow composer compacts rather than squeezing the controls', () => {
  // The side panel is ~300px: the row cannot hold its labels and the send
  // button at once, and a viewport breakpoint cannot see that.
  measuredWidth = 300
  const { container } = renderActions()

  const row = actionsRow(container)
  expect(row).toHaveAttribute('data-compact', 'true')
  // The status wraps onto its own line rather than disappearing — it is the only
  // place a send failure is ever reported.
  expect(row?.childElementCount).toBe(2)
  expect(row?.lastElementChild).toHaveTextContent('Working')
})

test('an existing chat can open the picker and change its model', async () => {
  renderActions({ existingSession: true })

  await userEvent.click(screen.getByRole('button', { name: 'Provider and model' }))
  expect(await screen.findByPlaceholderText('Search models')).toBeVisible()
  expect(screen.queryByRole('button', { name: /Other provider/ })).toBeNull()
  await userEvent.click(await screen.findByRole('option', { name: /Alternate model/ }))

  expect(useChatInputDraftStore.getState().getDraft(draftTarget).modelSelection).toMatchObject({
    model: 'alternate',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  })
})

test('a new chat can still choose a different provider', async () => {
  renderActions()

  await userEvent.click(screen.getByRole('button', { name: 'Provider and model' }))
  await userEvent.click(await screen.findByRole('button', { name: /Other provider/ }))
  await userEvent.click(await screen.findByRole('option', { name: /Other model/ }))

  expect(useChatInputDraftStore.getState().getDraft(draftTarget).modelSelection).toMatchObject({
    model: 'other-model',
    providerInstanceId: 'other-provider',
  })
})

function actionsRow(container: HTMLElement) {
  return container.querySelector('[data-composer-actions]')
}

function renderActions({ existingSession = false } = {}) {
  resetChatInputDraftStore()
  initializePromptStashStore(environmentScopedStorage(FIXTURE_ENVIRONMENT_ID))

  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, {
    providers: [
      providerSnapshot({
        displayLabel: 'Other provider',
        providerInstanceId: v.parse(providerInstanceIdSchema, 'other-provider'),
        models: [
          providerModel({ slug: 'other-model', name: 'Other model', shortName: 'Other model' }),
        ],
      }),
      providerSnapshot({
        models: [
          providerModel(),
          providerModel({
            slug: 'alternate',
            name: 'Alternate model',
            shortName: 'Alternate model',
          }),
        ],
      }),
    ],
  })

  async function dispatchCommand(_command: ClientOrchestrationCommand) {
    return { result: null, deduped: false, sequence: 1 }
  }

  return renderWithProviders(
    <ChatProviderSignInProvider>
      <ChatComposerModesProvider
        dispatchCommand={dispatchCommand}
        draftTarget={draftTarget}
        sessionId={sessionId}
      >
        <ChatModelPickerProvider
          draftTarget={draftTarget}
          sessionProviderInstanceId={existingSession ? DEFAULT_PROVIDER_INSTANCE_ID : null}
          modelSelection={{
            model: 'gpt-5.5',
            providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
          }}
          persistModelSelection={() => {}}
        >
          <LexicalComposer
            initialConfig={{
              namespace: 'chat-input-actions-test',
              onError: (error) => {
                throw error
              },
            }}
          >
            <ChatInputActions
              busy={false}
              disabled={false}
              draftTarget={draftTarget}
              interactionMode='default'
              runtimeMode='full-access'
              sendDisabled={false}
              statusLabel='Working'
              onSelectImageFiles={() => {}}
              onStop={() => {}}
              onSubmit={async () => true}
            />
          </LexicalComposer>
        </ChatModelPickerProvider>
      </ChatComposerModesProvider>
    </ChatProviderSignInProvider>,
    { queryClient },
  )
}
