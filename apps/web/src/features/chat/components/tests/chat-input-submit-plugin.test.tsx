import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { KEY_ENTER_COMMAND, type LexicalEditor } from 'lexical'
import { useEffect } from 'react'

import { ChatInputSubmitPlugin } from '@/features/chat/components/chat-input-submit-plugin'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('Enter that only commits an IME composition never sends', () => {
  const composer = renderComposer()

  composer.pressEnter({ isComposing: true })
  // The pre-`isComposing` signal counts too: some IMEs only send that one.
  composer.pressEnter({ keyCode: 229 })

  expect(composer.submits).toBe(0)
})

test('Enter after the composition is committed sends', () => {
  const composer = renderComposer()

  composer.pressEnter({ isComposing: true })
  composer.pressEnter({})

  expect(composer.submits).toBe(1)
})

test('an IME Enter is swallowed rather than prevented, so the commit still lands', () => {
  const composer = renderComposer()

  const event = composer.pressEnter({ isComposing: true })

  expect(event.defaultPrevented).toBe(false)
})

test('Ctrl/Cmd+Enter requests the alternate intent while Enter keeps the default', () => {
  const composer = renderComposer()
  composer.pressEnter({})
  composer.pressEnter({ ctrlKey: true })
  composer.pressEnter({ metaKey: true })
  composer.pressEnter({ shiftKey: true })
  expect(composer.intents).toEqual([false, true, true])
})

function renderComposer() {
  const state = { editor: null as LexicalEditor | null, submits: 0, intents: [] as boolean[] }

  function captureEditor(editor: LexicalEditor) {
    state.editor = editor
  }

  renderWithProviders(
    <LexicalComposer
      initialConfig={{
        namespace: 'chat-input-submit-plugin-test',
        onError: (error) => {
          throw error
        },
      }}
    >
      <CaptureEditor onReady={captureEditor} />
      <ChatInputSubmitPlugin
        commandMenuOpen={false}
        disabled={false}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onSubmitRequest={async (alternate = false) => {
          state.intents.push(alternate)
          state.submits += 1
          return true
        }}
      />
    </LexicalComposer>,
  )

  return {
    pressEnter(init: KeyboardEventInit) {
      // Cancelable, or `preventDefault` is a no-op and the swallow/prevent
      // distinction this suite asserts on could never be observed.
      const event = new KeyboardEvent('keydown', { cancelable: true, key: 'Enter', ...init })
      state.editor?.dispatchCommand(KEY_ENTER_COMMAND, event)

      return event
    },
    get intents() {
      return state.intents
    },
    get submits() {
      return state.submits
    },
  }
}

function CaptureEditor({ onReady }: { readonly onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}
