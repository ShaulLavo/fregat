import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { act, screen, waitFor } from '@testing-library/react'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'
import { PASTE_COMMAND, type LexicalEditor } from 'lexical'
import { ChatInputDraftPlugin } from '../chat-input-draft-plugin'
import { ChatInputPasteFoldPlugin } from '../chat-input-paste-fold-plugin'
import { prepareChatInputFile } from '../../utils/input-attachments'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'
import { test, expect } from '../../../../../test/fixtures'
import { useChatInputDraftStore } from '../../state/chat-input-draft-store'

test('a large paste rejected at the attachment limit is retained inline', async () => {
  const target = { environmentId: TEST_ENVIRONMENT_ID, draftKey: 'paste-full', rootPath: '/repo' }
  useChatInputDraftStore.getState().setPrompt(target, '')
  let editor: LexicalEditor | null = null
  const text = 'x'.repeat(40 * 1024)
  renderWithProviders(
    <LexicalComposer
      initialConfig={{
        namespace: 'paste-full',
        onError: (error) => {
          throw error
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label='Paste composer' />}
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
      <ChatInputPasteFoldPlugin
        onFiles={async (files) => {
          const result = await prepareChatInputFile(files[0]!, MAX_CHAT_ATTACHMENTS)
          expect(result.status).toBe('reject')
          return result.status === 'accept'
        }}
      />
    </LexicalComposer>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  const event = new ClipboardEvent('paste', { clipboardData, cancelable: true })
  act(() => {
    editor!.dispatchCommand(PASTE_COMMAND, event)
  })
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Paste composer' }).textContent).toBe(text),
  )
})
