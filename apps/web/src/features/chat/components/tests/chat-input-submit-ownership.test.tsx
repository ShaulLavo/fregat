import { ChatComposerModesProvider } from '../../providers/composer-modes-provider'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'
import { ChatInput } from '../chat-input'
import { ChatProviderSignInProvider } from '../../providers/provider-sign-in-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '../../state/chat-input-draft-store'
import { initializePromptStashStore } from '../../state/prompt-stash-store'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { providerListQueryOptions } from '../../utils/provider-query'
import type { ChatInputSubmitResult } from '../../utils/composed-message'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders, createTestQueryClient } from '../../../../../test/render'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import {
  fixtureSessionId,
  providerSnapshot,
  session,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'

beforeEach(() => {
  resetChatInputDraftStore()
  initializePromptStashStore(environmentScopedStorage(TEST_ENVIRONMENT_ID))
})

test('a delayed successful send cannot clear the editor navigated to while it was pending', async () => {
  const fixture = pendingComposer()
  useChatInputDraftStore.getState().setPrompt(fixture.otherTarget, 'Other session draft')
  const view = renderWithProviders(fixture.element(fixture.target.draftKey), {
    queryClient: fixture.queryClient,
  })
  await waitFor(() =>
    expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('Submitted prompt'),
  )
  fireEvent.click(view.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce())
  view.rerender(fixture.element(fixture.otherTarget.draftKey))
  await waitFor(() =>
    expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('Other session draft'),
  )
  await act(async () => fixture.resolve('sent'))
  expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('Other session draft')
  expect(useChatInputDraftStore.getState().getDraft(fixture.otherTarget).prompt).toBe(
    'Other session draft',
  )
  expect(useChatInputDraftStore.getState().getDraft(fixture.target).prompt).toBe('')
})

test('a later edit to the submitted draft survives a successful receipt', async () => {
  const fixture = pendingComposer()
  const view = renderWithProviders(fixture.element(fixture.target.draftKey), {
    queryClient: fixture.queryClient,
  })
  await waitFor(() =>
    expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('Submitted prompt'),
  )
  fireEvent.click(view.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce())
  act(() => useChatInputDraftStore.getState().setPrompt(fixture.target, 'Newer content'))
  await act(async () => fixture.resolve('sent'))
  expect(useChatInputDraftStore.getState().getDraft(fixture.target).prompt).toBe('Newer content')
  expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('Newer content')
})

function pendingComposer() {
  const running = session()
  const target = {
    environmentId: TEST_ENVIRONMENT_ID,
    draftKey: fixtureSessionId(1),
    rootPath: '/repo',
  }
  const otherTarget = { ...target, draftKey: fixtureSessionId(2) }
  useChatInputDraftStore.getState().setPrompt(target, 'Submitted prompt')
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(providerListQueryOptions().queryKey, { providers: [providerSnapshot()] })
  const deferred = Promise.withResolvers<ChatInputSubmitResult>()
  const submit = vi.fn(() => deferred.promise)
  return {
    target,
    otherTarget,
    queryClient,
    submit,
    resolve: deferred.resolve,
    element: (draftKey: string) => (
      <TestEditorStateProvider>
        <ChatProviderSignInProvider>
          <ChatComposerModesProvider
            draftTarget={{ ...target, draftKey }}
            sessionId={null}
            dispatchCommand={unsupportedChatTransport().dispatchCommand}
          >
            <ChatInput
              busy={false}
              disabled={false}
              draftKey={draftKey}
              error={null}
              interactionMode={running.interactionMode}
              modelSelection={running.modelSelection}
              runtimeMode={running.runtimeMode}
              rootPath={target.rootPath}
              onPersistModelSelection={() => {}}
              onStop={() => {}}
              onSubmit={submit}
            />
          </ChatComposerModesProvider>
        </ChatProviderSignInProvider>
      </TestEditorStateProvider>
    ),
  }
}
