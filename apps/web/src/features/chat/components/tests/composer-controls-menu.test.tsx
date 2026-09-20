import { getClient } from '@/lib/client'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'
import { providerSnapshot } from '../../../../../test/factories/chat'
import { ChatModelPickerProvider } from '@/features/chat/providers/model-picker-provider'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  sessionIdSchema,
  type ClientOrchestrationCommand,
  type InteractionMode,
  type RuntimeMode,
} from '@workspace/contracts'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as v from 'valibot'

import { ComposerControlsMenu } from '@/features/chat/components/composer-controls-menu'
import { ChatComposerModesProvider } from '@/features/chat/providers/composer-modes-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const sessionId = v.parse(sessionIdSchema, '0b1cf4bb-c595-5929-9994-7174e9f096ef')
const draftTarget: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: sessionId,
  rootPath: '/repo/platform',
}

test('the trigger reports the session values while the draft has no override', async () => {
  await renderMenu()

  expect(trigger()).toHaveTextContent('Full access')
  expect(trigger()).not.toHaveTextContent('Plan')
})

test('choosing an access level writes it to the draft and back onto the trigger', async () => {
  await renderMenu()

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Ask first/ }))

  expect(draft().runtimeMode).toBe('approval-required')
  expect(trigger()).toHaveTextContent('Ask first')
})

test('choosing an access level also sets it on the session itself', async () => {
  const { dispatched } = await renderMenu()

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Ask first/ }))

  expect(dispatched).toHaveLength(1)
  expect(dispatched[0]).toMatchObject({
    runtimeMode: 'approval-required',
    sessionId,
    type: 'session.runtime-mode.set',
  })
})

test('plan mode lands in the draft and shows on the composer', async () => {
  await renderMenu()

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Plan/ }))

  expect(draft().interactionMode).toBe('plan')
  expect(trigger()).toHaveTextContent('Plan')
})

test('plan mode is set on the session, not only on the next turn', async () => {
  const { dispatched } = await renderMenu()

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Plan/ }))

  expect(dispatched[0]).toMatchObject({
    interactionMode: 'plan',
    sessionId,
    type: 'session.interaction-mode.set',
  })
})

test('a rejected session sync leaves the pick on the composer so the turn still carries it', async () => {
  await renderMenu({}, () => Promise.reject(new Error('offline')))

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Ask first/ }))

  expect(draft().runtimeMode).toBe('approval-required')
  expect(await screen.findByRole('button', { name: 'Agent access and mode' })).toHaveTextContent(
    'Ask first',
  )
})

test('an override survives a reopen as the checked option', async () => {
  await renderMenu({ interactionMode: 'plan', runtimeMode: 'approval-required' })

  await openMenu()
  await userEvent.click(await screen.findByRole('menuitemradio', { name: /Auto-accept edits/ }))
  await userEvent.keyboard('{Escape}')
  await openMenu()

  const checked = await screen.findAllByRole('menuitemradio', { checked: true })
  expect(checked.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Auto-accept edits'),
    expect.stringContaining('Plan'),
  ])
})

async function renderMenu(
  session: {
    interactionMode?: InteractionMode
    runtimeMode?: RuntimeMode
    planModeEnabled?: boolean
    supported?: boolean
  } = {},
  dispatch?: () => Promise<{ result: null; deduped: boolean; sequence: number }>,
) {
  await getClient().settings.write.post({
    target: 'user',
    mutationId: crypto.randomUUID(),
    operations: [
      { kind: 'set', key: 'chat.planModeEnabled', value: session.planModeEnabled ?? true },
    ],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, {
    providers: [providerSnapshot({ showInteractionModeToggle: session.supported ?? true })],
  })
  resetChatInputDraftStore()

  const dispatched: ClientOrchestrationCommand[] = []
  const dispatchCommand = async (command: ClientOrchestrationCommand) => {
    dispatched.push(command)
    if (dispatch) return dispatch()

    return { result: null, deduped: false, sequence: 1 }
  }

  renderWithProviders(
    <ChatComposerModesProvider
      dispatchCommand={dispatchCommand}
      draftTarget={draftTarget}
      sessionId={sessionId}
    >
      <ChatModelPickerProvider
        draftTarget={draftTarget}
        sessionProviderInstanceId={DEFAULT_PROVIDER_INSTANCE_ID}
        modelSelection={{ providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'mock' }}
        persistModelSelection={() => {}}
      >
        <ComposerControlsMenu
          disabled={false}
          draftTarget={draftTarget}
          interactionMode={session.interactionMode ?? 'default'}
          runtimeMode={session.runtimeMode ?? 'full-access'}
        />
      </ChatModelPickerProvider>
    </ChatComposerModesProvider>,
    { queryClient },
  )

  return { dispatched }
}

function trigger() {
  return screen.getByRole('button', { name: 'Agent access and mode' })
}

async function openMenu() {
  await userEvent.click(trigger())
}

function draft() {
  return useChatInputDraftStore.getState().getDraft(draftTarget)
}

test('default-hidden and unsupported Plan controls retain stored preference without exposing the action', async () => {
  await renderMenu({ interactionMode: 'plan', planModeEnabled: false })
  await openMenu()
  expect(screen.queryByRole('menuitemradio', { name: /Plan/ })).toBeNull()
  expect(trigger()).not.toHaveTextContent('Plan')
})
