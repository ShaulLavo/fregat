import { useEditor, useEditorSelector } from '@singapore-editor/react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type MouseEvent,
} from 'react'

import { ChatInputDraftPlugin } from '@/features/chat/components/chat-input-draft-plugin'
import { ChatInputHistoryPlugin } from '@/features/chat/components/chat-input-history-plugin'
import { ChatInputPasteFoldPlugin } from '@/features/chat/components/chat-input-paste-fold-plugin'
import { ChatInputSubmitPlugin } from '@/features/chat/components/chat-input-submit-plugin'
import { useRegisterChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import {
  COMPOSER_EDITOR_THEME,
  COMPOSER_SURROUND_PAIRS,
  createChatInputMentionPlugin,
} from '@/features/chat/utils/composer-plugins'
import { filesFromClipboard } from '@/features/chat/utils/input-attachments'
import {
  createChatInputEditorHandle,
  moveChatInputCaretToLineBoundary,
  type ChatInputEditorHandle,
} from '@/features/chat/utils/input-editor-actions'
import type { ChatInputTrigger } from '@/features/chat/utils/input-logic'
import { usePresentation } from '@workspace/ui/patterns/sheet'

const DESKTOP_MIN_HEIGHT_PX = 56
const PHONE_MIN_HEIGHT_PX = 24
const MAX_HEIGHT_PX = 192
const LINE_HEIGHT_PX = 24

export function ChatInputEditor({
  ariaLabel = 'Message',
  disabled,
  draftKey,
  initialText = '',
  namespace,
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
  ariaLabel?: string
  disabled: boolean
  draftKey: string
  initialText?: string
  namespace?: string
  onCommandMenuCommit: () => boolean
  onCommandMenuMove: (offset: number) => boolean
  onEditorReady: (editor: ChatInputEditorHandle | null) => void
  onImageFiles: (files: readonly File[]) => Promise<boolean>
  onSubmitRequest: (alternate?: boolean) => Promise<boolean>
  onTriggerChange: (trigger: ChatInputTrigger | null) => void
  placeholder: string
  rootPath: string
  trigger: ChatInputTrigger | null
}) {
  const phone = usePresentation() === 'sheet'
  const registerEditor = useRegisterChatInputEditor()
  const hostElementRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<ChatInputEditorHandle | null>(null)
  const composingRef = useRef(false)
  const [empty, setEmpty] = useState(initialText.length === 0)

  const documentSpec = useMemo(
    () => ({
      defaultText: initialText,
      documentId: namespace ?? `platform-chat-input:${rootPath}:${draftKey}`,
    }),
    [draftKey, initialText, namespace, rootPath],
  )

  const controller = useEditor({
    autoClosingPairs: [],
    cursorLineHighlight: {
      gutterBackground: false,
      gutterNumber: false,
      rowBackground: false,
    },
    detectIndentation: false,
    document: documentSpec,
    editability: disabled ? 'readonly' : 'editable',
    folding: false,
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    inputKind: 'prose',
    inputLabel: ariaLabel,
    lineHeight: LINE_HEIGHT_PX,
    onChange() {
      const text = controller.materializeFullText()
      setEmpty(text.length === 0)
    },
    scrollMode: 'virtualized',
    scrollPastEnd: false,
    surroundingPairs: COMPOSER_SURROUND_PAIRS,
    tabMovesFocus: true,
    theme: COMPOSER_EDITOR_THEME,
    wordWrap: true,
    wordWrapBreak: 'word',
  })

  const { ref: editorMountRef } = controller
  const editorInstance = useEditorSelector(controller, (snapshot) => snapshot.editor)
  const contentHeight = useSyncExternalStore(
    (listener) => {
      if (!editorInstance) return () => {}
      const disposable = editorInstance.onDidChangeContentHeight(listener)
      return () => disposable.dispose()
    },
    () => {
      const height = editorInstance?.getContentHeight() ?? 0
      return height > 0 ? height : LINE_HEIGHT_PX
    },
    () => LINE_HEIGHT_PX,
  )

  useEffect(() => {
    if (!editorInstance) {
      handleRef.current = null
      registerEditor(null)
      return
    }

    const inputElement = editorInstance.getInputElement()
    inputElement.setAttribute('aria-placeholder', placeholder)

    const onCompositionStart = () => {
      composingRef.current = true
    }
    const onCompositionEnd = () => {
      composingRef.current = false
    }
    const onLineBoundaryKey = (event: KeyboardEvent) => {
      if (event.key !== 'End' && event.key !== 'Home') return
      if (event.altKey || event.ctrlKey || event.isComposing || event.metaKey) return
      const currentHandle = handleRef.current
      if (!currentHandle) return
      const edge = event.key === 'End' ? 'end' : 'start'
      if (!moveChatInputCaretToLineBoundary(currentHandle, edge, event.shiftKey)) return
      event.preventDefault()
      event.stopPropagation()
    }

    inputElement.addEventListener('compositionstart', onCompositionStart)
    inputElement.addEventListener('compositionend', onCompositionEnd)
    inputElement.addEventListener('keydown', onLineBoundaryKey, true)

    const mentionDisposable = editorInstance.addPlugin(
      createChatInputMentionPlugin(() => {
        const primary = editorInstance.getSelections()[0]
        if (!primary || primary.anchorOffset !== primary.headOffset) return null
        return primary.anchorOffset
      }),
    )

    const handle = createChatInputEditorHandle(editorInstance, {
      getRootElement: () => hostElementRef.current,
      isComposing: () => composingRef.current,
    })
    handleRef.current = handle
    registerEditor(handle)

    return () => {
      mentionDisposable.dispose()
      inputElement.removeEventListener('compositionstart', onCompositionStart)
      inputElement.removeEventListener('compositionend', onCompositionEnd)
      inputElement.removeEventListener('keydown', onLineBoundaryKey, true)
      composingRef.current = false
      handleRef.current = null
      registerEditor(null)
    }
  }, [editorInstance, placeholder, registerEditor])

  const handlePasteCapture = (event: ClipboardEvent<HTMLElement>) => {
    if (disabled) return
    const files = filesFromClipboard(event.clipboardData)
    if (files.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopPropagation()
    void onImageFiles(files)
  }

  const minHeight = phone ? PHONE_MIN_HEIGHT_PX : DESKTOP_MIN_HEIGHT_PX
  const clampedHeight = Math.min(MAX_HEIGHT_PX, Math.max(minHeight, contentHeight))

  const attachHostRef = (element: HTMLDivElement | null) => {
    hostElementRef.current = element
    return editorMountRef(element)
  }

  const handlePaddingClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || event.target !== event.currentTarget) return
    handleRef.current?.focus()
  }

  return (
    // Phone: one line when empty; clicking the outer padding focuses the editor so all of it takes the tap.
    <div
      className='relative px-(--density-section-padding) pt-(--density-section-padding) pb-(--density-section-gap)'
      onClick={handlePaddingClick}
      onPasteCapture={handlePasteCapture}
    >
      <div
        className='text-foreground scroll-gutter phone:min-h-0 block max-h-48 min-h-14 w-full bg-transparent text-sm leading-6 outline-none'
        data-composer-namespace={namespace ?? `platform-chat-input:${rootPath}:${draftKey}`}
        data-testid='chat-input-editor'
        ref={attachHostRef}
        style={{ height: `${clampedHeight}px` }}
      />
      {empty ? (
        <div className='text-muted-foreground pointer-events-none absolute inset-x-(--density-section-padding) top-(--density-section-padding) text-sm leading-6'>
          {placeholder}
        </div>
      ) : null}
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
      <ChatInputHistoryPlugin
        disabled={disabled || trigger !== null}
        draftKey={draftKey}
        rootPath={rootPath}
      />
      <ChatInputPasteFoldPlugin onFiles={onImageFiles} />
    </div>
  )
}
