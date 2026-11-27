import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach } from 'vitest'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import {
  readChatInputText,
  replaceChatInputEditorRange,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

beforeEach(() => {
  resetChatInputDraftStore()
  stubEditorViewport({ height: 120, width: 400 })
})

test('a mention in the prompt renders as a chip labelled with its file', async () => {
  const composer = renderComposer('read @"src/my file.ts" now')

  await waitFor(() => expect(composer.chip('src/my file.ts')?.textContent).toBe('my file.ts'))
  // The chip is the prompt: what submit reads back is the serialized mention.
  expect(composer.text).toBe('read @"src/my file.ts" now')
})

test('backspace behind a chip removes the whole mention in one press', () => {
  const composer = renderComposer('read @"src/my file.ts"')

  composer.editor.setSelection(composer.text.length)
  composer.pressBackspace()

  expect(composer.text).toBe('read ')
  expect(composer.chip('src/my file.ts')).toBeNull()
})

test('backspace on a selected chip removes it', () => {
  const composer = renderComposer('read @"src/my file.ts" now')

  composer.editor.setSelection(5, 22)
  composer.pressBackspace()

  expect(composer.text).toBe('read  now')
})

test('pasting a serialized prompt rehydrates its mentions as chips', async () => {
  const composer = renderComposer('')

  composer.paste('look at @"src/my file.ts" please')

  expect(composer.text).toBe('look at @"src/my file.ts" please')
  await waitFor(() => expect(composer.chip('src/my file.ts')?.textContent).toBe('my file.ts'))
})

test('pasting plain prose inserts text without creating mention chips', () => {
  const composer = renderComposer('')

  composer.paste('just prose')

  expect(composer.text).toBe('just prose')
  expect(composer.anyChip()).toBeNull()
})

test('typing an active bare mention query keeps it editable so Backspace deletes one character', async () => {
  const composer = renderComposer('')

  act(() => {
    composer.editor.editRange(0, 0, '@srcc', { anchor: 5 })
  })
  expect(composer.anyChip()).toBeNull()
  composer.pressBackspace()
  expect(composer.text).toBe('@src')
  expect(composer.anyChip()).toBeNull()

  act(() => {
    composer.editor.editRange(4, 4, ' ', { anchor: 5 })
  })
  await waitFor(() => expect(composer.chip('src')?.textContent).toBe('src'))
})

test('a menu-committed bare mention stays atomic after ArrowLeft and deletes in one Backspace', async () => {
  const composer = renderComposer('check ')

  act(() => {
    composer.editor.focus()
    composer.editor.setSelection(6)
    composer.editor.editRange(6, 6, '@AGENTS', { anchor: 13 })
  })
  expect(composer.anyChip()).toBeNull()

  act(() => {
    replaceChatInputEditorRange(composer.editor, {
      expectedText: '@AGENTS',
      rangeEnd: 13,
      rangeStart: 6,
      replacement: '@AGENTS.md ',
    })
  })
  await waitFor(() => expect(composer.chip('AGENTS.md')?.textContent).toBe('AGENTS.md'))
  expect(composer.text).toBe('check @AGENTS.md ')
  expect(composer.editor.getSelectionOffsets()).toEqual({ anchor: 17, focus: 17 })

  act(() => {
    fireEvent.keyDown(composer.editor.getInputElement(), { key: 'ArrowLeft' })
  })
  expect(composer.editor.getSelectionOffsets()).toEqual({ anchor: 16, focus: 16 })
  expect(composer.chip('AGENTS.md')?.textContent).toBe('AGENTS.md')

  composer.pressBackspace()
  expect(composer.text).toBe('check  ')
  expect(composer.anyChip()).toBeNull()

  act(() => {
    fireEvent.keyDown(composer.editor.getInputElement(), { ctrlKey: true, key: 'z' })
  })
  await waitFor(() => expect(composer.chip('AGENTS.md')?.textContent).toBe('AGENTS.md'))
  expect(composer.text).toBe('check @AGENTS.md ')
  expect(composer.lastTrigger()).toBeNull()

  composer.pressBackspace()
  expect(composer.text).toBe('check  ')
  expect(composer.anyChip()).toBeNull()
})

function renderComposer(initialText: string) {
  useChatInputDraftStore.getState().setPrompt(
    {
      environmentId: TEST_ENVIRONMENT_ID,
      draftKey: 'mention-node-test',
      rootPath: '/tmp/mention-node-test',
    },
    initialText,
  )
  const state = {
    editor: null as ChatInputEditorHandle | null,
    lastTrigger: null as unknown,
  }

  const rendered = renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        disabled={false}
        draftKey='mention-node-test'
        initialText={initialText}
        placeholder='Message'
        rootPath='/tmp/mention-node-test'
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={(editor) => {
          state.editor = editor
        }}
        onImageFiles={async () => true}
        onSubmitRequest={async () => false}
        onTriggerChange={(next) => {
          state.lastTrigger = next
        }}
      />
    </ChatInputEditorProvider>,
  )

  expect(state.editor).not.toBeNull()
  const editor = state.editor!

  return {
    editor,
    anyChip() {
      return rendered.container.querySelector('[data-chat-input-mention]')
    },
    chip(path: string) {
      return rendered.container.querySelector(`[data-chat-input-mention="${path}"]`)
    },
    lastTrigger() {
      return state.lastTrigger
    },
    paste(text: string) {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: clipboardWithText(text) })
      act(() => {
        editor.getInputElement().dispatchEvent(event)
      })
      return event
    },
    pressBackspace() {
      act(() => {
        fireEvent.keyDown(editor.getInputElement(), { key: 'Backspace' })
      })
    },
    get text() {
      return readChatInputText(editor)
    },
  }
}

function clipboardWithText(text: string) {
  return {
    files: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: [],
    types: ['text/plain'],
  } as unknown as DataTransfer
}
