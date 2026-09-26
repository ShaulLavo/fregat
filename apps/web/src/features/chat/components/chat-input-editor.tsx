import { Editor } from '@singapore-editor/core/editor'
import type { DocumentSessionChange } from '@singapore-editor/core/document'
import { EDITOR_PASTE_HANDLER, type EditorPlugin } from '@singapore-editor/core/extensions'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'

import { useChatInputDraftSync } from '@/features/chat/hooks/use-chat-input-draft-sync'
import { useChatInputKeys } from '@/features/chat/hooks/use-chat-input-keys'
import {
  readChatInputDraftPrompt,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { createComposerMentionProvider } from '@/features/chat/utils/composer-mention-provider'
import { createComposerPasteHandler } from '@/features/chat/utils/composer-paste-handler'
import {
  foldChatInputPaste,
  readChatInputTextSnapshot,
} from '@/features/chat/utils/input-editor-actions'
import {
  CHAT_INPUT_SURROUND_PAIRS,
  detectChatInputTrigger,
  type ChatInputTrigger,
} from '@/features/chat/utils/input-logic'
import { nextPastedTextFileName } from '@/features/chat/utils/pasted-text'
import { mountChatInputMentionChip } from './chat-input-mention-chip'

const ROW_HEIGHT = 24
const MIN_HEIGHT = 56
const MAX_HEIGHT = 192

/**
 * The prompt, on our own editor. The buffer holds the message exactly as it is sent, `@path`
 * mentions included; chips are painted over those mentions and step and delete as one unit.
 */
export function ChatInputEditor({
  disabled,
  draftTarget,
  onCommandMenuCommit,
  onCommandMenuMove,
  onEditorReady,
  onImageFiles,
  onSubmitRequest,
  onTriggerChange,
  placeholder,
  trigger,
}: {
  disabled: boolean
  draftTarget: ChatInputDraftTarget
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
  onEditorReady: (editor: Editor | null) => void
  onImageFiles: (files: readonly File[]) => Promise<boolean>
  onSubmitRequest: (alternate?: boolean) => Promise<boolean>
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  placeholder: string
  trigger: ChatInputTrigger | null
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const foldedNames = useRef(new Set<string>())
  const [editor, setEditor] = useState<Editor | null>(null)
  const [contentHeight, setContentHeight] = useState(ROW_HEIGHT)
  const [empty, setEmpty] = useState(() => readChatInputDraftPrompt(draftTarget).length === 0)

  const takeInlinePaste = useChatInputKeys(hostRef, editor, {
    commandMenuOpen: trigger !== null,
    disabled,
    draftTarget,
    onCommandMenuCommit,
    onCommandMenuMove,
    onSubmitRequest,
  })

  const handleChange = useEffectEvent((current: Editor, change: DocumentSessionChange | null) => {
    const { cursor, text } = readChatInputTextSnapshot(current)
    setEmpty(text.length === 0)
    if (change === null || change.edits.length > 0) {
      const store = useChatInputDraftStore.getState()
      if (store.getDraft(draftTarget).prompt !== text) store.setPrompt(draftTarget, text)
    }
    onTriggerChange(detectChatInputTrigger(text, cursor))
  })
  const attachFiles = useEffectEvent((files: readonly File[]) => void onImageFiles(files))
  const foldText = useEffectEvent((current: Editor, text: string) => {
    const name = nextPastedTextFileName(foldedNames.current)
    foldedNames.current.add(name)
    void foldChatInputPaste(current, text, name, onImageFiles)
  })
  const takeInlineRequest = useEffectEvent(() => takeInlinePaste())
  const initialPrompt = useEffectEvent(() => readChatInputDraftPrompt(draftTarget))
  const announceEditor = useEffectEvent((next: Editor | null) => onEditorReady(next))
  const rootPath = useEffectEvent(() => draftTarget.rootPath)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    let created: Editor | null = null
    const pastePlugin: EditorPlugin = {
      name: 'chat.composerPaste',
      activate: (context) =>
        context.registerCapabilityContribution({
          createContribution: (contributed) =>
            contributed.registerProvider(
              EDITOR_PASTE_HANDLER,
              { language: '*' },
              createComposerPasteHandler({
                attachFiles: (files) => attachFiles(files),
                documentText: () => created?.materializeFullText() ?? '',
                foldText: (text) => {
                  if (created) foldText(created, text)
                },
                rootPath: () => rootPath(),
                takeInlineRequest: () => takeInlineRequest(),
              }),
            ),
        }),
    }
    const instance = new Editor(host, {
      autoClosingPairs: [],
      detectIndentation: false,
      folding: false,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      inputKind: 'prose',
      inputLabel: 'Message',
      inputRoute: 'edit-context',
      lineHeight: ROW_HEIGHT,
      onChange: (_state, change) => {
        if (created) handleChange(created, change)
      },
      plugins: [pastePlugin],
      scrollPastEnd: false,
      surroundingPairs: CHAT_INPUT_SURROUND_PAIRS,
      tabMovesFocus: true,
      wordWrap: true,
      wordWrapBreak: 'word',
    })
    created = instance
    instance.setInlineReplacementProvider(
      createComposerMentionProvider(mountChatInputMentionChip),
      { trigger: 'edit' },
    )
    instance.setText(initialPrompt())
    const heights = instance.onDidChangeContentHeight(setContentHeight)
    setContentHeight(instance.getContentHeight())
    setEditor(instance)
    announceEditor(instance)

    return () => {
      heights.dispose()
      announceEditor(null)
      setEditor(null)
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    editor?.setEditability(disabled ? 'readonly' : 'editable')
  }, [disabled, editor])

  useEffect(() => {
    editor?.getInputElement().setAttribute('aria-placeholder', placeholder)
  }, [editor, placeholder])

  useChatInputDraftSync(editor, draftTarget)

  return (
    <div className='relative px-(--density-section-padding) pt-(--density-section-padding) pb-(--density-section-gap)'>
      <div
        className='chat-composer-editor-host flex w-full flex-col overflow-hidden text-sm'
        data-testid='chat-input-editor'
        ref={hostRef}
        style={{ height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight)) }}
      />
      {empty ? (
        <div className='text-muted-foreground pointer-events-none absolute inset-x-(--density-section-padding) top-(--density-section-padding) text-sm leading-6'>
          {placeholder}
        </div>
      ) : null}
    </div>
  )
}
