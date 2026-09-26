import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { $getSelection, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import { useEffect } from 'react'
import { vi } from 'vitest'

import { ChatInputLineBoundaryPlugin } from '@/features/chat/components/chat-input-line-boundary-plugin'
import { CHAT_INPUT_EDITOR_NODES } from '@/features/chat/components/chat-input-mention-node'
import {
  $readChatInputTextSnapshot,
  $setChatInputText,
  insertChatInputMention,
  insertChatInputText,
  moveChatInputCaretToLineBoundary,
  replaceChatInputEditorRange,
  surroundChatInputSelection,
} from '@/features/chat/utils/input-editor-actions'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('a mention committed mid-sentence leaves the caret right after the inserted text', () => {
  const editor = mountChatInputEditor('read @ap now')

  const applied = replaceChatInputEditorRange(editor, {
    expectedText: '@ap',
    rangeEnd: 8,
    rangeStart: 5,
    replacement: '@src/app.ts ',
  })

  expect(applied?.text).toBe('read @src/app.ts now')
  expect(snapshot(editor)).toEqual({ cursor: 17, text: 'read @src/app.ts now' })
})

test('the replacement eats the space the prompt already had, so no double space lands', () => {
  const editor = mountChatInputEditor('read @ap now')

  replaceChatInputEditorRange(editor, {
    rangeEnd: 8,
    rangeStart: 5,
    replacement: '@src/app.ts ',
  })

  expect(snapshot(editor).text).toBe('read @src/app.ts now')
})

test('a second commit against the now-stale range is refused', () => {
  const editor = mountChatInputEditor('read @ap now')
  const range = { expectedText: '@ap', rangeEnd: 8, rangeStart: 5, replacement: '@src/app.ts ' }

  replaceChatInputEditorRange(editor, range)
  const second = replaceChatInputEditorRange(editor, range)

  expect(second).toBeNull()
  expect(snapshot(editor).text).toBe('read @src/app.ts now')
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
  expect(snapshot(editor)).toEqual({ cursor: 23, text: 'read @"src/my file.ts" ' })
})

test('inserting a mention writes it through the grammar and leaves the caret after it', () => {
  const editor = mountChatInputEditor('read ')

  expect(insertChatInputMention(editor, 'src/my file.ts')).toBe(true)

  expect(snapshot(editor)).toEqual({ cursor: 23, text: 'read @"src/my file.ts" ' })
})

test('a focusing insert focuses only once the DOM holds the inserted text', async () => {
  const editor = mountChatInputEditor('read ')
  const root = editor.getRootElement()
  const seenAtFocus: { text: string; decorators: number }[] = []
  const focus = editor.focus.bind(editor)
  vi.spyOn(editor, 'focus').mockImplementation((...args) => {
    seenAtFocus.push({
      text: root?.textContent ?? '',
      decorators: root?.querySelectorAll('[data-lexical-decorator]').length ?? 0,
    })
    focus(...args)
  })

  insertChatInputMention(editor, 'src/app.ts', { focus: true })

  // Lexical's DOM holds the chip's node at focus; React fills in its label afterwards.
  await vi.waitFor(() => expect(seenAtFocus).toEqual([{ text: 'read  ', decorators: 1 }]))
  await vi.waitFor(() => expect(root?.textContent).toBe('read app.ts '))
  await vi.waitFor(() => expect(document.activeElement).toBe(root))
})

test('an insert without focus leaves focus where it was', async () => {
  const editor = mountChatInputEditor('read ')
  const focus = vi.spyOn(editor, 'focus')

  insertChatInputText(editor, 'more')
  editor.read(() => undefined)

  expect(focus).not.toHaveBeenCalled()
})

test('inserted prompt text keeps offsets right for the prose that follows a mention', () => {
  const editor = mountChatInputEditor('')

  insertChatInputText(editor, 'see @"a b.ts" and @c.ts then')

  expect(snapshot(editor)).toEqual({ cursor: 28, text: 'see @"a b.ts" and @c.ts then' })
})

test('Home and End move the caret to the bounds of the current line', () => {
  const editor = mountChatInputEditor('first line\nsecond line')

  pressKey(editor, 'Home')
  expect(snapshot(editor).cursor).toBe(11)

  pressKey(editor, 'End')
  expect(snapshot(editor).cursor).toBe(22)
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
  expect(snapshot(editor).text).toBe('(wrap this word)')
  expect(selectedText(editor)).toBe('wrap this word')
})

function mountChatInputEditor(text: string) {
  const state = { editor: null as LexicalEditor | null }

  renderWithProviders(
    <LexicalComposer
      initialConfig={{
        editorState: () => {
          $setChatInputText(text)
        },
        namespace: 'chat-input-editor-actions-test',
        nodes: CHAT_INPUT_EDITOR_NODES,
        onError: (error) => {
          throw error
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
        placeholder={null}
      />
      <ChatInputLineBoundaryPlugin />
      <CaptureEditor
        onReady={(editor) => {
          state.editor = editor
        }}
      />
    </LexicalComposer>,
  )

  const editor = state.editor
  if (!editor) throw new Error('chat input editor never mounted')

  return editor
}

function CaptureEditor({ onReady }: { readonly onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}

function pressKey(editor: LexicalEditor, key: string, init: KeyboardEventInit = {}) {
  editor.dispatchCommand(
    KEY_DOWN_COMMAND,
    new KeyboardEvent('keydown', { cancelable: true, key, ...init }),
  )
}

// `editor.read` flushes the pending update first; `getEditorState()` would still
// be showing the state from before the action under test.
function snapshot(editor: LexicalEditor) {
  return editor.read(() => $readChatInputTextSnapshot())
}

function selectedText(editor: LexicalEditor) {
  return editor.read(() => $getSelection()?.getTextContent() ?? '')
}
