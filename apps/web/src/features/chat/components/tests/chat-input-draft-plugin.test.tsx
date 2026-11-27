import { act, screen, waitFor } from '@testing-library/react'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  readChatInputText,
  setChatInputText,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const target = {
  environmentId: TEST_ENVIRONMENT_ID,
  draftKey: 'draft-sync-test',
  rootPath: '/repo',
}

test('external draft restoration updates the mounted composer without stealing focus or losing later edits', async () => {
  const drafts = useChatInputDraftStore.getState()
  drafts.setPrompt(target, 'Newer draft')
  let editor: ChatInputEditorHandle | null = null
  renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        ariaLabel='Test composer'
        disabled={false}
        draftKey={target.draftKey}
        placeholder='Message'
        rootPath={target.rootPath}
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={(value) => {
          editor = value
        }}
        onImageFiles={async () => true}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
      <button type='button'>Keep focus</button>
    </ChatInputEditorProvider>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  await waitFor(() => expect(readChatInputText(editor!)).toBe('Newer draft'))
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
  act(() => setChatInputText(editor!, 'Edited after restoration'))
  await waitFor(() => expect(drafts.getDraft(target).prompt).toBe('Edited after restoration'))
  act(() =>
    drafts.restoreContent(
      { ...target, draftKey: 'other-draft' },
      { prompt: 'Other session', attachments: [], terminalContexts: [] },
    ),
  )
  expect(readChatInputText(editor!)).toBe('Edited after restoration')
})
