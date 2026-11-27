import { detectPlatform } from '@shaulavo/hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { PromptStashBadge } from '@/features/chat/components/prompt-stash-badge'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import {
  initializePromptStashStore,
  promptStashStoreFor,
  resetPromptStashStore,
} from '@/features/chat/state/prompt-stash-store'
import {
  readChatInputText,
  setChatInputText,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const draftTarget: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: '736c83c6-b5a4-5584-92a3-30e04eb26b13',
  rootPath: '/repo/platform',
}

test('the badge stays out of the way until something is stashed', () => {
  renderComposer()

  expect(screen.queryByRole('button', { name: /Stashed prompts/ })).toBeNull()
})

test('Mod+S parks the composer prompt and empties the composer', async () => {
  const composer = renderComposer()

  composer.type('rewrite the ingestion reactor')
  await composer.pressStashShortcut()

  expect(stashedPrompts()).toEqual(['rewrite the ingestion reactor'])
  expect(composer.text).toBe('')
  expect(await screen.findByRole('button', { name: 'Stashed prompts: 1' })).toBeVisible()
})

test('stash yields when focus has left the composer', async () => {
  const composer = renderComposer()
  composer.type('keep typing here')
  act(() => screen.getByRole('textbox', { name: 'Message' }).blur())
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${modifier}>}s{/${modifier}}`)
  expect(stashedPrompts()).toEqual([])
  expect(composer.text).toBe('keep typing here')
})

test('restoring puts the prompt back and spends the stash entry', async () => {
  const composer = renderComposer()

  composer.type('rewrite the ingestion reactor')
  await composer.pressStashShortcut()
  await userEvent.click(screen.getByRole('button', { name: 'Stashed prompts: 1' }))
  await userEvent.click(await screen.findByRole('button', { name: /^rewrite the ingestion/ }))

  expect(composer.text).toBe('rewrite the ingestion reactor')
  expect(stashedPrompts()).toEqual([])
})

test('a prompt in progress swaps into the stash rather than being overwritten', async () => {
  const composer = renderComposer()

  composer.type('first idea')
  await composer.pressStashShortcut()
  composer.type('second idea')
  await userEvent.click(screen.getByRole('button', { name: 'Stashed prompts: 1' }))
  await userEvent.click(await screen.findByRole('button', { name: /^first idea/ }))

  expect(composer.text).toBe('first idea')
  expect(stashedPrompts()).toEqual(['second idea'])
})

test('a stashed prompt can be thrown away without going back to the composer', async () => {
  const composer = renderComposer()

  composer.type('abandoned idea')
  await composer.pressStashShortcut()
  await userEvent.click(screen.getByRole('button', { name: 'Stashed prompts: 1' }))
  await userEvent.click(await screen.findByRole('button', { name: /Delete stashed prompt/ }))

  expect(stashedPrompts()).toEqual([])
  expect(composer.text).toBe('')
})

test('a queued restore keeps its captured draft and cannot focus the composer navigated to', async () => {
  const composer = renderComposer()
  composer.type('same prompt')
  await composer.pressStashShortcut()
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const blocker = composer.queryClient
    .getMutationCache()
    .build(composer.queryClient, {
      mutationKey: ['test', 'hold-stash-preparation'],
      scope: { id: `stash:${draftTarget.environmentId}` },
      mutationFn: () => hold,
    })
    .execute(undefined)
  await userEvent.click(screen.getByRole('button', { name: 'Stashed prompts: 1' }))
  await userEvent.click(await screen.findByRole('button', { name: /^same prompt/ }))
  const other = { ...draftTarget, draftKey: 'other-composer' }
  useChatInputDraftStore.getState().setPrompt(other, 'same prompt')
  composer.navigate(other)
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  const focused = document.activeElement
  await act(async () => {
    release()
    await blocker
  })
  await waitFor(() => expect(stashedPrompts()).toEqual([]))
  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe('same prompt')
  expect(useChatInputDraftStore.getState().getDraft(other).prompt).toBe('same prompt')
  expect(document.activeElement).toBe(focused)
})

function stashedPrompts() {
  return promptStashStoreFor(testScopedStorage.environmentId)
    .getState()
    .entries.map((entry) => entry.prompt)
}

function renderComposer() {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()
  resetChatInputDraftStore()
  const state = { editor: null as ChatInputEditorHandle | null }

  const element = (target: ChatInputDraftTarget) => (
    <ChatInputEditorProvider>
      <ChatInputEditor
        disabled={false}
        draftKey={target.draftKey ?? ''}
        placeholder='Message'
        rootPath={target.rootPath}
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={(editor) => {
          state.editor = editor
        }}
        onImageFiles={async () => true}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
      <PromptStashBadge disabled={false} draftTarget={target} />
    </ChatInputEditorProvider>
  )
  const rendered = renderWithProviders(element(draftTarget))

  return {
    queryClient: rendered.queryClient,
    navigate: (target: ChatInputDraftTarget) => rendered.rerender(element(target)),
    async pressStashShortcut() {
      screen.getByRole('textbox', { name: 'Message' }).focus()
      const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
      await userEvent.keyboard(`{${modifier}>}s{/${modifier}}`)
    },
    get text() {
      const editor = state.editor
      return editor ? readChatInputText(editor) : ''
    },
    type(text: string) {
      if (state.editor) setChatInputText(state.editor, text)
      useChatInputDraftStore.getState().setPrompt(draftTarget, text)
    },
  }
}
