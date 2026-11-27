import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  insertChatInputMention,
  insertChatInputText,
  moveChatInputCaretToLineBoundary,
  readChatInputSelection,
  readChatInputTextSnapshot,
  replaceChatInputEditorRange,
  surroundChatInputSelection,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

beforeEach(() => {
  resetChatInputDraftStore()
  stubEditorViewport({ height: 120, width: 400 })
})

test('a mention committed mid-sentence leaves the caret right after the inserted text', () => {
  const editor = mountChatInputEditor('read @ap now')

  const applied = replaceChatInputEditorRange(editor, {
    expectedText: '@ap',
    rangeEnd: 8,
    rangeStart: 5,
    replacement: '@src/app.ts ',
  })

  expect(applied?.text).toBe('read @src/app.ts now')
  expect(readChatInputTextSnapshot(editor)).toEqual({ cursor: 17, text: 'read @src/app.ts now' })
})

test('the replacement eats the space the prompt already had, so no double space lands', () => {
  const editor = mountChatInputEditor('read @ap now')

  replaceChatInputEditorRange(editor, {
    rangeEnd: 8,
    rangeStart: 5,
    replacement: '@src/app.ts ',
  })

  expect(readChatInputTextSnapshot(editor).text).toBe('read @src/app.ts now')
})

test('a second commit against the now-stale range is refused', () => {
  const editor = mountChatInputEditor('read @ap now')
  const range = { expectedText: '@ap', rangeEnd: 8, rangeStart: 5, replacement: '@src/app.ts ' }

  replaceChatInputEditorRange(editor, range)
  const second = replaceChatInputEditorRange(editor, range)

  expect(second).toBeNull()
  expect(readChatInputTextSnapshot(editor).text).toBe('read @src/app.ts now')
})

test('a committed mention with a space in its path stays one token, caret behind it', () => {
  const editor = mountChatInputEditor('read @my fi')

  const applied = replaceChatInputEditorRange(editor, {
    expectedText: '@my fi',
    rangeEnd: 11,
    rangeStart: 5,
    replacement: '@"src/my file.ts" ',
  })

  expect(applied?.text).toBe('read @"src/my file.ts" ')
  expect(readChatInputTextSnapshot(editor)).toEqual({
    cursor: 23,
    text: 'read @"src/my file.ts" ',
  })
})

test('inserting a mention writes it through the grammar and leaves the caret after it', () => {
  const editor = mountChatInputEditor('read ')

  expect(insertChatInputMention(editor, 'src/my file.ts')).toBe(true)

  expect(readChatInputTextSnapshot(editor)).toEqual({
    cursor: 23,
    text: 'read @"src/my file.ts" ',
  })
})

test('a focusing insert focuses only once the editor holds the inserted mention', async () => {
  const editor = mountChatInputEditor('read ')
  await waitFor(() =>
    expect(editor.getRootElement()?.querySelector('.editor-virtualized-row')).not.toBeNull(),
  )
  const seenAtFocus: { text: string; chips: number }[] = []
  const originalFocus = editor.focus
  const root = editor.getRootElement()
  const focusSpy = vi.fn(() => {
    seenAtFocus.push({
      chips: root?.querySelectorAll('[data-chat-input-mention]').length ?? 0,
      text: editor.getText(),
    })
    originalFocus()
  })
  const trackedEditor: ChatInputEditorHandle = { ...editor, focus: focusSpy }

  insertChatInputMention(trackedEditor, 'src/app.ts', { focus: true })

  expect(seenAtFocus).toEqual([{ chips: 1, text: 'read @src/app.ts ' }])
  expect(document.activeElement).toBe(editor.getInputElement())
})

test('an insert without focus leaves focus where it was', () => {
  const editor = mountChatInputEditor('read ')
  const focusSpy = vi.fn()
  const trackedEditor: ChatInputEditorHandle = { ...editor, focus: focusSpy }

  insertChatInputText(trackedEditor, 'more')

  expect(focusSpy).not.toHaveBeenCalled()
})

test('inserted prompt text keeps offsets right for the prose that follows a mention', () => {
  const editor = mountChatInputEditor('')

  insertChatInputText(editor, 'see @"a b.ts" and @c.ts then')

  expect(readChatInputTextSnapshot(editor)).toEqual({
    cursor: 28,
    text: 'see @"a b.ts" and @c.ts then',
  })
})

test('Home and End move the caret to the bounds of the current line', () => {
  const editor = mountChatInputEditor('first line\nsecond line')

  pressKey(editor, 'Home')
  expect(readChatInputTextSnapshot(editor).cursor).toBe(11)

  pressKey(editor, 'End')
  expect(readChatInputTextSnapshot(editor).cursor).toBe(22)
})

test('shift extends the selection to the line boundary instead of moving the caret', () => {
  const editor = mountChatInputEditor('first line\nsecond line')

  pressKey(editor, 'Home', { shiftKey: true })

  expect(selectedText(editor)).toBe('second line')
})

test('Home at the start of the line is left to the browser', () => {
  const editor = mountChatInputEditor('only line')

  moveChatInputCaretToLineBoundary(editor, 'start', false)

  expect(moveChatInputCaretToLineBoundary(editor, 'start', false)).toBe(false)
})

test('typing a bracket over a selection wraps it and keeps the wrapped text selected', () => {
  const editor = mountChatInputEditor('wrap this word')

  moveChatInputCaretToLineBoundary(editor, 'start', false)
  moveChatInputCaretToLineBoundary(editor, 'end', true)

  expect(surroundChatInputSelection(editor, '(', ')')).toBe(true)
  expect(readChatInputTextSnapshot(editor).text).toBe('(wrap this word)')
  expect(selectedText(editor)).toBe('wrap this word')
})

test('replaceChatInputEditorRange returns null when the editor is readonly', () => {
  const editor = mountChatInputEditor('Hello world')
  editor.setEditable(false)

  expect(
    replaceChatInputEditorRange(editor, {
      expectedText: 'world',
      rangeEnd: 11,
      rangeStart: 6,
      replacement: 'friend',
    }),
  ).toBeNull()
  expect(readChatInputTextSnapshot(editor).text).toBe('Hello world')
})

function mountChatInputEditor(text: string): ChatInputEditorHandle {
  useChatInputDraftStore.getState().setPrompt(
    {
      environmentId: TEST_ENVIRONMENT_ID,
      draftKey: 'chat-input-editor-actions-test',
      rootPath: '/repo',
    },
    text,
  )
  const state = { editor: null as ChatInputEditorHandle | null }

  renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        disabled={false}
        draftKey='chat-input-editor-actions-test'
        initialText={text}
        placeholder='Message'
        rootPath='/repo'
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
    </ChatInputEditorProvider>,
  )

  expect(state.editor).not.toBeNull()
  const editor = state.editor!
  editor.setSelection(text.length)
  return editor
}

function pressKey(editor: ChatInputEditorHandle, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(editor.getInputElement(), { key, ...init })
  })
}

function selectedText(editor: ChatInputEditorHandle) {
  const { text, selection } = readChatInputSelection(editor)
  return text.slice(selection.start, selection.end)
}
