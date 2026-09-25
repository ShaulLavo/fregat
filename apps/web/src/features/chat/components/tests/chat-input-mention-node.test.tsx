import { beforeEach } from 'vitest'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '../../state/chat-input-draft-store'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createNodeSelection,
  $getRoot,
  $isElementNode,
  $setSelection,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { useEffect } from 'react'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import {
  $isChatInputMentionNode,
  CHAT_INPUT_EDITOR_NODES,
} from '@/features/chat/components/chat-input-mention-node'
import {
  $readChatInputTextSnapshot,
  $setChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

beforeEach(() => resetChatInputDraftStore())

test('a mention in the prompt renders as a chip labelled with its file', () => {
  const composer = renderComposer('read @"src/my file.ts" now')

  const chip = composer.chip('src/my file.ts')

  expect(chip).not.toBeNull()
  expect(chip?.textContent).toBe('my file.ts')
  // The chip is the prompt: what submit reads back is the serialized mention.
  expect(composer.text).toBe('read @"src/my file.ts" now')
})

test('backspace behind a chip removes the whole mention in one press', () => {
  const composer = renderComposer('read @"src/my file.ts"')

  composer.pressBackspace()

  expect(composer.text).toBe('read ')
  expect(composer.chip('src/my file.ts')).toBeNull()
})

test('backspace on a selected chip removes it instead of doing nothing', () => {
  const composer = renderComposer('read @"src/my file.ts" now')

  composer.selectChip()
  composer.pressBackspace()

  expect(composer.text).toBe('read  now')
})

test('pasting a serialized prompt rehydrates its mentions as chips', () => {
  const composer = renderComposer('')

  composer.paste('look at @"src/my file.ts" please')

  expect(composer.text).toBe('look at @"src/my file.ts" please')
  expect(composer.chip('src/my file.ts')?.textContent).toBe('my file.ts')
})

// Lexical's own plain-text paste needs a live DOM selection, which no synthetic
// event gives it — so the observable here is that we stayed out of the way.
test('a paste with no mention in it is left to the editor to handle', () => {
  const composer = renderComposer('')

  composer.paste('just prose')

  expect(composer.text).toBe('')
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
  const state = { editor: null as LexicalEditor | null }

  const rendered = renderWithProviders(
    <LexicalComposer
      initialConfig={{
        editorState: () => {
          $setChatInputText(initialText)
        },
        namespace: 'chat-input-mention-node-test',
        nodes: CHAT_INPUT_EDITOR_NODES,
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
      <ChatInputEditor
        disabled={false}
        draftKey='mention-node-test'
        placeholder='Message'
        rootPath='/tmp/mention-node-test'
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={() => {}}
        onImageFiles={async () => true}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
    </LexicalComposer>,
  )

  const editor = state.editor
  if (!editor) throw new Error('chat input editor never mounted')

  return {
    chip(path: string) {
      return rendered.container.querySelector(`[data-chat-input-mention="${path}"]`)
    },
    paste(text: string) {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: clipboardWithText(text) })
      rendered.getByTestId('chat-input-editor').dispatchEvent(event)

      return event
    },
    selectChip() {
      editor.update(() => {
        const paragraph = $getRoot().getFirstChild()
        if (!$isElementNode(paragraph)) return

        const mention = paragraph.getChildren().find((node) => $isChatInputMentionNode(node))
        if (!mention) return

        const selection = $createNodeSelection()
        selection.add(mention.getKey())
        $setSelection(selection)
      })
    },
    pressBackspace() {
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent('keydown', { cancelable: true, key: 'Backspace' }),
      )
    },
    get text() {
      return editor.read(() => $readChatInputTextSnapshot().text)
    },
  }
}

// happy-dom has no ClipboardEvent; this is the slice of `DataTransfer` that
// React, our paste handler and Lexical's own plain-text paste all read.
function clipboardWithText(text: string) {
  return {
    files: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: [],
    types: ['text/plain'],
  } as unknown as DataTransfer
}

function CaptureEditor({ onReady }: { readonly onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}
