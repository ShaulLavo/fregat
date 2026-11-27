import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach } from 'vitest'

import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { useVoiceInput } from '@/features/chat/hooks/use-voice-input'
import { ChatInputEditorProvider } from '@/features/chat/providers/composer-editor-provider'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import {
  insertChatInputText,
  readChatInputText,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { createSpeechRecognitionFixture } from '../../../../../test/factories/speech-recognition'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const target = {
  environmentId: TEST_ENVIRONMENT_ID,
  draftKey: 'voice-commit-test',
  rootPath: '/repo',
}

type SpeechWindow = Window & {
  SpeechRecognition?: ReturnType<typeof createSpeechRecognitionFixture>
}

let previousRecognition: SpeechWindow['SpeechRecognition']
let previousSecureContext: PropertyDescriptor | undefined

beforeEach(() => {
  resetChatInputDraftStore()
  stubEditorViewport({ height: 120, width: 400 })
  previousRecognition = (window as SpeechWindow).SpeechRecognition
  previousSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
})

afterEach(() => {
  ;(window as SpeechWindow).SpeechRecognition = previousRecognition
  if (previousSecureContext) Object.defineProperty(window, 'isSecureContext', previousSecureContext)
  else Reflect.deleteProperty(window, 'isSecureContext')
})

function VoiceComposerHarness({
  onEditor,
}: {
  readonly onEditor: (editor: ChatInputEditorHandle | null) => void
}) {
  const editorRef = useRef<ChatInputEditorHandle | null>(null)
  const voice = useVoiceInput(target, editorRef)

  return (
    <ChatInputEditorProvider>
      <ChatInputEditor
        ariaLabel='Voice composer'
        disabled={voice.pending}
        draftKey={target.draftKey}
        initialText='Hello world again'
        placeholder='Message'
        rootPath={target.rootPath}
        trigger={null}
        onCommandMenuCommit={() => false}
        onCommandMenuMove={() => false}
        onEditorReady={(editor) => {
          editorRef.current = editor
          onEditor(editor)
        }}
        onImageFiles={async () => true}
        onSubmitRequest={async () => false}
        onTriggerChange={() => {}}
      />
      <button type='button' onClick={voice.start}>
        Start dictation
      </button>
      <button type='button' onClick={voice.finish}>
        Finish dictation
      </button>
    </ChatInputEditorProvider>
  )
}

test('dictation commits an undoable edit with a collapsed caret so the next keystroke appends cleanly', async () => {
  const Fixture = createSpeechRecognitionFixture()
  ;(window as SpeechWindow).SpeechRecognition = Fixture
  useChatInputDraftStore.getState().setPrompt(target, 'Hello world again')

  let editor: ChatInputEditorHandle | null = null
  renderWithProviders(
    <VoiceComposerHarness
      onEditor={(value) => {
        editor = value
      }}
    />,
  )

  await waitFor(() => expect(editor).not.toBeNull())
  await waitFor(() => expect(readChatInputText(editor!)).toBe('Hello world again'))

  act(() => {
    editor!.focus()
    editor!.setSelection(6, 11)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }))
  await waitFor(() => expect(Fixture.current).not.toBeNull())
  await waitFor(() => expect(editor!.isEditable()).toBe(false))

  act(() => {
    Fixture.current!.result('friend')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Finish dictation' }))

  await waitFor(() => expect(editor!.isEditable()).toBe(true))
  expect(readChatInputText(editor!)).toBe('Hello friend again')
  expect(editor!.getSelectionOffsets()).toEqual({ anchor: 12, focus: 12 })

  act(() => {
    insertChatInputText(editor!, 'X')
  })
  expect(readChatInputText(editor!)).toBe('Hello friendX again')

  act(() => {
    editor!.editor.dispatchCommand('undo')
    editor!.editor.dispatchCommand('undo')
  })
  expect(readChatInputText(editor!)).toBe('Hello world again')
})
