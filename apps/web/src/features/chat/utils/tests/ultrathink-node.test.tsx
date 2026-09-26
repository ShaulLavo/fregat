import { $getRoot, createEditor, type LexicalEditor } from 'lexical'

import { CHAT_INPUT_EDITOR_NODES } from '@/features/chat/components/chat-input-mention-node'
import {
  $readChatInputTextSnapshot,
  $setChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import { registerUltrathinkEntity } from '@/features/chat/utils/ultrathink-node'
import { expect, test } from '../../../../../test/fixtures'

test('the word becomes one rainbow span and the prompt text is unchanged', async () => {
  const { editor, root } = mountEditor()
  registerUltrathinkEntity(editor, true)
  await write(editor, 'Please ultrathink about ultrathinking.')

  const painted = [...root.querySelectorAll('.rainbow-text')].map((span) => span.textContent)
  expect(painted).toEqual(['ultrathink'])
  expect(editor.read(() => $readChatInputTextSnapshot().text)).toBe(
    'Please ultrathink about ultrathinking.',
  )
})

test('a model without the word reverts painted text to plain', async () => {
  const { editor, root } = mountEditor()
  const unregister = registerUltrathinkEntity(editor, true)
  await write(editor, 'ultrathink it')
  expect(root.querySelector('.rainbow-text')).not.toBeNull()

  unregister()
  registerUltrathinkEntity(editor, false)
  await settle(editor)
  expect(root.querySelector('.rainbow-text')).toBeNull()
  expect(editor.read(() => $getRoot().getTextContent())).toBe('ultrathink it')
})

function mountEditor() {
  const editor = createEditor({
    namespace: 'ultrathink-node-test',
    nodes: CHAT_INPUT_EDITOR_NODES,
    onError: (error) => {
      throw error
    },
  })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  editor.setRootElement(root)

  return { editor, root }
}

async function write(editor: LexicalEditor, text: string) {
  editor.update(() => $setChatInputText(text))
  await settle(editor)
}

/** Updates and their transforms commit in a microtask. */
function settle(editor: LexicalEditor) {
  return new Promise<void>((resolve) => editor.update(() => {}, { onUpdate: resolve }))
}
