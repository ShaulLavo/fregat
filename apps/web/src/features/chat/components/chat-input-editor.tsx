import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { collectComposerMentions } from '@workspace/contracts'
import type { LexicalEditor } from 'lexical'
import { type ClipboardEvent } from 'react'

import { filesFromClipboard } from '@/features/chat/utils/input-attachments'
import { insertChatInputText } from '@/features/chat/utils/input-editor-actions'
import type { ChatInputTrigger } from '@/features/chat/utils/input-logic'
import { ChatInputDraftPlugin } from './chat-input-draft-plugin'
import { ChatInputLineBoundaryPlugin } from './chat-input-line-boundary-plugin'
import { ChatInputMentionPlugin } from './chat-input-mention-plugin'
import { ChatInputPasteFoldPlugin } from './chat-input-paste-fold-plugin'
import { ChatInputSubmitPlugin } from './chat-input-submit-plugin'
import { ChatInputSurroundPlugin } from './chat-input-surround-plugin'
import { ChatInputHistoryPlugin } from '@/features/chat/components/chat-input-history-plugin'

export function ChatInputEditor({
  disabled,
  draftKey,
  onCommandMenuCommit,
  onCommandMenuMove,
  onEditorReady,
  onImageFiles,
  onSubmitRequest,
  onTriggerChange,
  placeholder,
  rootPath,
  trigger,
}: {
  disabled: boolean
  draftKey: string
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
  onEditorReady: (editor: LexicalEditor | null) => void
  onImageFiles: (files: readonly File[]) => Promise<boolean>
  onSubmitRequest: (alternate?: boolean) => Promise<boolean>
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  placeholder: string
  rootPath: string
  trigger: ChatInputTrigger | null
}) {
  const [editor] = useLexicalComposerContext()
  // Drops are handled by the composer container so the attachment strip and the
  // action row are droppable too; paste stays here, on the element that owns the
  // caret.
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = filesFromClipboard(event.clipboardData)
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
  }

  return (
    <div className='relative px-(--density-section-padding) pt-(--density-section-padding) pb-(--density-section-gap)'>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label='Message'
            aria-placeholder={placeholder}
            className='app-scrollbar-thin text-foreground block max-h-48 min-h-14 w-full overflow-y-auto bg-transparent text-sm leading-6 break-words whitespace-pre-wrap outline-none'
            data-testid='chat-input-editor'
            placeholder={<span />}
            onPaste={handlePaste}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
        placeholder={
          <div className='text-muted-foreground pointer-events-none absolute inset-x-(--density-section-padding) top-(--density-section-padding) text-sm leading-6'>
            {placeholder}
          </div>
        }
      />
      <ChatInputDraftPlugin
        disabled={disabled}
        draftKey={draftKey}
        rootPath={rootPath}
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
      <ChatInputPasteFoldPlugin onFiles={onImageFiles} />
      <ChatInputSurroundPlugin />
      <HistoryPlugin />
    </div>
  )
}
