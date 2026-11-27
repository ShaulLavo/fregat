import { detectPlatform } from '@shaulavo/hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import { prepareChatInputFile } from '@/features/chat/utils/input-attachments'
import {
  readChatInputText,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

function createPasteEvent(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: [],
      types: ['text/plain'],
    },
  })
  return event
}

test('a large paste rejected at the attachment limit is retained inline', async () => {
  const target = { environmentId: TEST_ENVIRONMENT_ID, draftKey: 'paste-full', rootPath: '/repo' }
  useChatInputDraftStore.getState().setPrompt(target, '')
  let editor: ChatInputEditorHandle | null = null
  const text = 'x'.repeat(40 * 1024)
  renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        ariaLabel='Paste composer'
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
        onImageFiles={async (files) => {
          const result = await prepareChatInputFile(files[0]!, MAX_CHAT_ATTACHMENTS)
          expect(result.status).toBe('reject')
          return result.status === 'accept'
        }}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
    </ChatInputEditorProvider>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  const input = screen.getByRole('textbox', { name: 'Paste composer' })
  act(() => {
    input.dispatchEvent(createPasteEvent(text))
  })
  await waitFor(() => expect(readChatInputText(editor!)).toBe(text))
})

test('Mod+Shift+V keeps a large paste inline and preserves native paste', async () => {
  let editor: ChatInputEditorHandle | null = null
  const text = 'y'.repeat(40 * 1024)
  let attached = 0
  renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        ariaLabel='Inline paste composer'
        disabled={false}
        draftKey='paste-inline'
        placeholder='Message'
        rootPath='/repo'
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={(value) => {
          editor = value
        }}
        onImageFiles={async () => {
          attached += 1
          return true
        }}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
    </ChatInputEditorProvider>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  const input = screen.getByRole('textbox', { name: 'Inline paste composer' })
  act(() => {
    input.focus()
  })
  const keyboardEvents: KeyboardEvent[] = []
  input.addEventListener('keydown', (event) => keyboardEvents.push(event))
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${modifier}>}{Shift>}v{/Shift}{/${modifier}}`)
  const inlineKey = keyboardEvents.find((event) => event.key.toLowerCase() === 'v')
  expect(inlineKey).toBeDefined()
  expect(inlineKey?.defaultPrevented).toBe(false)

  const pasteEvent = createPasteEvent(text)
  act(() => {
    input.dispatchEvent(pasteEvent)
  })
  expect(attached).toBe(0)
  await waitFor(() => expect(readChatInputText(editor!)).toBe(text))
  expect(attached).toBe(0)
})
