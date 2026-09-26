import { Editor } from '@singapore-editor/core/editor'
import { onTestFinished } from 'vitest'

import {
  clearChatInputEditor,
  insertChatInputMention,
  insertChatInputText,
  readChatInputTextSnapshot,
  replaceChatInputEditorRange,
  setChatInputEditorText,
  syncChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { expect, test } from '../../../../../test/fixtures'

test('a mention committed mid-sentence leaves the caret right after the inserted text', () => {
  const editor = mountEditor('read @ap now')

  const applied = replaceChatInputEditorRange(editor, {
    expectedText: '@ap',
    rangeEnd: 8,
    rangeStart: 5,
    replacement: '@src/app.ts ',
  })

  expect(applied?.text).toBe('read @src/app.ts now')
  expect(readChatInputTextSnapshot(editor)).toEqual({ cursor: 17, text: 'read @src/app.ts now' })
})

test('a second commit against the now-stale range is refused', () => {
  const editor = mountEditor('read @ap now')
  const range = { expectedText: '@ap', rangeEnd: 8, rangeStart: 5, replacement: '@src/app.ts ' }

  replaceChatInputEditorRange(editor, range)
  const second = replaceChatInputEditorRange(editor, range)

  expect(second).toBeNull()
  expect(editor.materializeFullText()).toBe('read @src/app.ts now')
})

test('a menu commit is one undo step', () => {
  const editor = mountEditor('read @ap now')

  replaceChatInputEditorRange(editor, { rangeEnd: 8, rangeStart: 5, replacement: '@src/app.ts ' })
  editor.dispatchCommand('undo')

  expect(editor.materializeFullText()).toBe('read @ap now')
})

test('text handed to an unfocused composer lands at the end of the prompt', () => {
  const editor = mountEditor('draft')
  editor.setSelection(0)

  insertChatInputText(editor, ' more')

  expect(editor.materializeFullText()).toBe('draft more')
})

test('a mention is inserted with the blank that separates it from what follows', () => {
  const editor = mountEditor('')

  insertChatInputMention(editor, 'src/my file.ts')

  expect(editor.materializeFullText()).toBe('@"src/my file.ts" ')
})

test('mirroring stored text takes no undo entry, and replacing the prompt takes one', () => {
  const editor = mountEditor('typed')

  syncChatInputText(editor, 'restored')
  expect(editor.getState().canUndo).toBe(false)

  setChatInputEditorText(editor, 'recalled prompt')
  expect(readChatInputTextSnapshot(editor)).toEqual({ cursor: 15, text: 'recalled prompt' })
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('restored')

  clearChatInputEditor(editor)
  expect(editor.materializeFullText()).toBe('')
})

function mountEditor(text: string) {
  stubHighlightApi()
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, { inputLabel: 'Message' })
  editor.setText(text)
  editor.setSelection(text.length)
  onTestFinished(() => {
    editor.dispose()
    container.remove()
  })
  return editor
}
