import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LexicalEditor } from 'lexical'
import { useEffect } from 'react'

import { PromptStashBadge } from '@/features/chat/components/prompt-stash-badge'
import { $setChatInputText, readChatInputText } from '@/features/chat/utils/input-editor-actions'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import {
  resetPromptStashStore,
  promptStashStoreFor,
  initializePromptStashStore,
} from '@/features/chat/state/prompt-stash-store'
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

test('⌘S parks the composer prompt and empties the composer', async () => {
  const composer = renderComposer()

  composer.type('rewrite the ingestion reactor')
  await composer.pressStashShortcut()

  expect(stashedPrompts()).toEqual(['rewrite the ingestion reactor'])
  expect(composer.text).toBe('')
  expect(await screen.findByRole('button', { name: 'Stashed prompts: 1' })).toBeVisible()
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
  const state = { editor: null as LexicalEditor | null }

  const element = (target: ChatInputDraftTarget) => (
    <LexicalComposer
      initialConfig={{
        namespace: 'prompt-stash-badge-test',
        onError: (error) => {
          throw error
        },
      }}
    >
      <CaptureEditor
        onReady={(editor) => {
          state.editor = editor
        }}
      />
      <PlainTextPlugin
        ErrorBoundary={LexicalErrorBoundary}
        contentEditable={<ContentEditable data-testid='composer' />}
      />
      <PromptStashBadge disabled={false} draftTarget={target} />
    </LexicalComposer>
  )
  const rendered = renderWithProviders(element(draftTarget))

  return {
    queryClient: rendered.queryClient,
    navigate: (target: ChatInputDraftTarget) => rendered.rerender(element(target)),
    async pressStashShortcut() {
      // The listener only fires for the composer the keystroke came from, so the
      // editor has to hold focus exactly as it does in the app.
      screen.getByTestId('composer').focus()
      await userEvent.keyboard('{Meta>}s{/Meta}')
    },
    get text() {
      const editor = state.editor
      return editor ? readChatInputText(editor) : ''
    },
    /** Stands in for the draft plugin: the editor and the draft move together. */
    type(text: string) {
      state.editor?.update(() => {
        $setChatInputText(text)
      })
      useChatInputDraftStore.getState().setPrompt(draftTarget, text)
    },
  }
}

function CaptureEditor({ onReady }: { readonly onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}
