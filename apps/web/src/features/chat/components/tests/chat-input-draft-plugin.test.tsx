import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { act, screen, waitFor } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { ChatInputDraftPlugin } from '@/features/chat/components/chat-input-draft-plugin'
import { CHAT_INPUT_EDITOR_NODES } from '@/features/chat/components/chat-input-mention-node'
import { $setChatInputText, readChatInputText } from '@/features/chat/utils/input-editor-actions'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'
import { test, expect } from '../../../../../test/fixtures'

const target = {
  environmentId: TEST_ENVIRONMENT_ID,
  draftKey: 'draft-sync-test',
  rootPath: '/repo',
}

test('external draft restoration updates the mounted composer without stealing focus or losing later edits', async () => {
  const drafts = useChatInputDraftStore.getState()
  drafts.setPrompt(target, 'Newer draft')
  let editor: LexicalEditor | null = null
  renderWithProviders(
    <LexicalComposer
      initialConfig={{
        namespace: 'draft-sync-test',
        nodes: CHAT_INPUT_EDITOR_NODES,
        onError: (error) => {
          throw error
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label='Test composer' />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ChatInputDraftPlugin
        disabled={false}
        draftKey={target.draftKey}
        rootPath={target.rootPath}
        onEditorReady={(value) => {
          editor = value
        }}
        onTriggerChange={() => {}}
      />
      <button type='button'>Keep focus</button>
    </LexicalComposer>,
  )
  const composer = screen.getByRole('textbox', { name: 'Test composer' })
  await waitFor(() => expect(composer.textContent).toBe('Newer draft'))
  const button = screen.getByRole('button', { name: 'Keep focus' })
  button.focus()
  act(() =>
    drafts.restoreContent(target, {
      prompt: 'Original prompt',
      attachments: [],
      terminalContexts: [],
    }),
  )
  await waitFor(() => expect(readChatInputText(editor!)).toBe('Original prompt\n\nNewer draft'))
  expect(button).toHaveFocus()
  act(() => editor!.update(() => $setChatInputText('Edited after restoration')))
  await waitFor(() => expect(drafts.getDraft(target).prompt).toBe('Edited after restoration'))
  act(() =>
    drafts.restoreContent(
      { ...target, draftKey: 'other-draft' },
      { prompt: 'Other session', attachments: [], terminalContexts: [] },
    ),
  )
  expect(composer.textContent).toBe('Edited after restoration')
})
