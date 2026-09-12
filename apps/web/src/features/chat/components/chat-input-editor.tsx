import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { collectComposerMentions } from '@workspace/contracts'
import type { LexicalEditor } from 'lexical'
import { useCallback, type ClipboardEvent, type RefObject } from 'react'

import { imageFilesFromClipboard } from '@/features/chat/utils/input-attachments'
import { insertChatInputText } from '@/features/chat/utils/input-editor-actions'
import type { ChatInputTrigger } from '@/features/chat/utils/input-logic'
import { ChatInputDraftPlugin } from './chat-input-draft-plugin'
import { ChatInputLineBoundaryPlugin } from './chat-input-line-boundary-plugin'
import { ChatInputMentionPlugin } from './chat-input-mention-plugin'
import { ChatInputSubmitPlugin } from './chat-input-submit-plugin'
import { ChatInputSurroundPlugin } from './chat-input-surround-plugin'
import { ChatInputHistoryPlugin } from '@/features/chat/components/chat-input-history-plugin'

export function ChatInputEditor({
  busy,
  disabled,
  draftKey,
  hasStagedContent,
  onCommandMenuCommit,
  onCommandMenuMove,
  onEditorReady,
  onFocusChange,
  onImageFiles,
  onSubmitRequest,
  onTriggerChange,
  placeholder,
  rootPath,
  sendButtonRef,
  submitting,
  submissionDisabled = false,
  trigger,
}: {
  busy: boolean
  disabled: boolean
  draftKey: string
  hasStagedContent: boolean
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
  onEditorReady: (editor: LexicalEditor | null) => void
  onFocusChange: (focused: boolean) => void
  onImageFiles: (files: readonly File[]) => void
  onSubmitRequest: () => Promise<boolean>
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  placeholder: string
  rootPath: string
  sendButtonRef: RefObject<HTMLButtonElement | null>
  submitting: boolean
  submissionDisabled?: boolean
  trigger: ChatInputTrigger | null
}) {
  const [editor] = useLexicalComposerContext()
  // Drops are handled by the composer container so the attachment strip and the
  // action row are droppable too; paste stays here, on the element that owns the
  // caret.
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const files = imageFilesFromClipboard(event.clipboardData)
      if (files.length > 0) {
        event.preventDefault()
        onImageFiles(files)

        return
      }

      // A pasted prompt carries mentions in their serialized form; letting the
      // browser drop them in as plain text is how a chip would decay into text.
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (collectComposerMentions(text).length === 0) return

      event.preventDefault()
      insertChatInputText(editor, text)
    },
    [editor, onImageFiles],
  )
  const handleBlur = useCallback(() => onFocusChange(false), [onFocusChange])
  const handleFocus = useCallback(() => onFocusChange(true), [onFocusChange])

  return (
    <div className='compact:px-3 compact:pt-3 compact:pb-1.5 relative px-4 pt-4 pb-2'>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label='Message'
            aria-placeholder={placeholder}
            className='app-scrollbar-thin text-foreground block max-h-48 min-h-14 w-full overflow-y-auto bg-transparent text-sm leading-6 break-words whitespace-pre-wrap outline-none'
            data-testid='chat-input-editor'
            placeholder={<span />}
            onBlur={handleBlur}
            onFocus={handleFocus}
            onPaste={handlePaste}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
        placeholder={
          <div className='text-muted-foreground/65 compact:top-3 compact:right-3 compact:left-3 pointer-events-none absolute top-4 right-4 left-4 text-sm leading-6'>
            {placeholder}
          </div>
        }
      />
      <ChatInputDraftPlugin
        busy={busy}
        disabled={disabled}
        draftKey={draftKey}
        hasStagedContent={hasStagedContent}
        rootPath={rootPath}
        sendButtonRef={sendButtonRef}
        submitting={submitting}
        submissionDisabled={submissionDisabled}
        onEditorReady={onEditorReady}
        onTriggerChange={onTriggerChange}
      />
      <ChatInputSubmitPlugin
        commandMenuOpen={trigger !== null}
        disabled={disabled}
        onCommandMenuCommit={onCommandMenuCommit}
        onCommandMenuMove={onCommandMenuMove}
        onSubmitRequest={onSubmitRequest}
      />
      <ChatInputLineBoundaryPlugin />
      <ChatInputHistoryPlugin
        disabled={disabled || trigger !== null}
        draftKey={draftKey}
        rootPath={rootPath}
      />
      <ChatInputMentionPlugin />
      <ChatInputSurroundPlugin />
      <HistoryPlugin />
    </div>
  )
}
