import { detectPlatform } from '@shaulavo/hotkeys'
import { act, fireEvent, screen } from '@testing-library/react'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
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
  composer.pressEnter(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true })
  composer.pressEnter({ shiftKey: true })
  expect(composer.intents).toEqual([false, true])
})

test('completion Enter belongs to the widget and does not submit', () => {
  const composer = renderComposer({ menuOpen: true })
  composer.pressEnter({})
  expect(composer.completions).toBe(1)
  expect(composer.submits).toBe(0)
})

test('a disabled composer declines submission', () => {
  const composer = renderComposer({ disabled: true })
  composer.pressEnter({})
  expect(composer.submits).toBe(0)
})

function renderComposer(
  options: { readonly disabled?: boolean; readonly menuOpen?: boolean } = {},
) {
  const state = { submits: 0, intents: [] as boolean[], completions: 0 }
  renderWithProviders(
    <ChatInputEditorProvider>
      <ChatInputEditor
        ariaLabel='Submit composer'
        disabled={options.disabled ?? false}
        draftKey='chat-input-submit-plugin-test'
        placeholder='Message'
        rootPath='/repo'
        trigger={
          options.menuOpen
            ? { kind: 'mention', query: '', rangeEnd: 1, rangeStart: 0, text: '@' }
            : null
        }
        onCommandMenuCommit={() => {
          state.completions += 1
          return true
        }}
        onCommandMenuMove={() => false}
        onEditorReady={() => {}}
        onImageFiles={async () => true}
        onSubmitRequest={async (alternate = false) => {
          state.intents.push(alternate)
          state.submits += 1
          return true
        }}
        onTriggerChange={() => {}}
      />
    </ChatInputEditorProvider>,
  )
  const root = screen.getByRole('textbox', { name: 'Submit composer' })
  act(() => root.focus())
  return {
    pressEnter(init: KeyboardEventInit) {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        ...init,
      })
      act(() => fireEvent(root, event))
      return event
    },
    get intents() {
      return state.intents
    },
    get submits() {
      return state.submits
    },
    get completions() {
      return state.completions
    },
  }
}
