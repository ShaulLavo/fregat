import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { useQuery } from '@tanstack/react-query'
import type {
  ChatAttachmentUpload,
  InteractionMode,
  ModelSelection,
  ProviderInstanceId,
  RuntimeMode,
} from '@workspace/contracts'
import { $setSelection, type LexicalEditor } from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { cn } from '@workspace/ui/lib/utils'

import {
  $setChatInputText,
  clearChatInputEditor,
  insertChatInputMention,
  readChatInputText,
  replaceChatInputEditorRange,
} from '@/features/chat/utils/input-editor-actions'
import { composerDropCarriesFiles, composerDropMentionPath } from '../utils/composer-drop'
import {
  chatInputUploadAttachments,
  imageFilesFromTransfer,
} from '@/features/chat/utils/input-attachments'
import {
  activeChatInputCommandItem,
  chatInputCommandItemByOffset,
  chatInputCommandItems,
  chatInputCommandMenuEmptyLabel,
  type ChatInputCommandItem,
  type ChatInputTrigger,
} from '@/features/chat/utils/input-logic'
import { useProjectEntrySearch } from '../hooks/use-project-entry-search'
import { providerCommandCatalogQueryOptions } from '@/features/chat/utils/composer-skills'
import { useComposerInbox } from '../hooks/use-composer-inbox'
import { useImagePreparation } from '@/features/chat/hooks/use-image-preparation'
import { useProviderDisplay } from '@/features/chat/hooks/use-provider-display'
import { chatSubmissionValidation } from '@/features/chat/utils/submission-validation'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { ChatModelPickerProvider } from '../providers/model-picker-provider'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import {
  readChatInputDraftPrompt,
  selectChatInputDraftImages,
  selectChatInputDraftTerminalContexts,
  useChatInputDraftStore,
  type ChatInputDraftStore,
  type ChatInputDraftTarget,
} from '../state/chat-input-draft-store'
import { ChatInputAttachmentList } from './chat-input-attachment-list'
import { ChatInputActions } from './chat-input-actions'
import { ChatInputCommandMenu } from './chat-input-command-menu'
import { ChatInputEditor } from './chat-input-editor'
import { ChatInputTerminalContextList } from './chat-input-terminal-context-list'
import { CHAT_INPUT_EDITOR_NODES } from './chat-input-mention-node'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type { ComposerPendingAction } from '@/features/chat/utils/composer-state'

export type ChatInputSubmitPayload = {
  attachments: ChatAttachmentUpload[]
  interactionMode: InteractionMode
  modelSelection: ModelSelection
  runtimeMode: RuntimeMode
  /** Captured output to serialize after the prompt. Never part of `text`. */
  terminalContexts: readonly TerminalContextSelection[]
  text: string
}

export function ChatInput({
  busy,
  correctionDisabledReason = null,
  disabled,
  disabledReason = null,
  draftKey,
  error,
  interactionMode,
  modelSelection,
  sessionProviderInstanceId = null,
  onPersistModelSelection,
  onStop,
  onSubmit,
  pendingAction = null,
  rootPath,
  runtimeMode,
}: {
  busy: boolean
  correctionDisabledReason?: string | null
  disabled: boolean
  disabledReason?: string | null
  pendingAction?: ComposerPendingAction
  draftKey: string
  error: string | null
  interactionMode: InteractionMode
  modelSelection: ModelSelection | null
  sessionProviderInstanceId?: ProviderInstanceId | null
  onPersistModelSelection: (modelSelection: ModelSelection) => void
  onStop: () => void
  onSubmit: (payload: ChatInputSubmitPayload) => Promise<boolean>
  rootPath: string
  runtimeMode: RuntimeMode
}) {
  const environmentId = useEnvironmentId()
  const inputKey = `${environmentId}:${rootPath}:${draftKey}`
  const draftTarget = useMemo<ChatInputDraftTarget>(
    () => ({ environmentId, draftKey, rootPath }),
    [environmentId, draftKey, rootPath],
  )
  const imagesSelector = useMemo(
    () => (state: ChatInputDraftStore) => selectChatInputDraftImages(state, draftTarget),
    [draftTarget],
  )
  const terminalContextsSelector = useMemo(
    () => (state: ChatInputDraftStore) => selectChatInputDraftTerminalContexts(state, draftTarget),
    [draftTarget],
  )
  const images = useChatInputDraftStore(imagesSelector)
  const terminalContexts = useChatInputDraftStore(terminalContextsSelector)
  const persistenceError = useChatInputDraftStore((store) => store.persistenceError)
  const clearStoredDraft = useChatInputDraftStore((store) => store.clearDraft)
  const clearStoredDraftContent = useChatInputDraftStore((store) => store.clearDraftContent)
  const removeImage = useChatInputDraftStore((store) => store.removeImage)
  const removeTerminalContext = useChatInputDraftStore((store) => store.removeTerminalContext)
  const setInteractionMode = useChatInputDraftStore((store) => store.setInteractionMode)
  const editorRef = useRef<LexicalEditor | null>(null)
  // State as well as the ref: the inbox only splices text once a caret exists,
  // and a ref cannot wake the effect that is waiting for one.
  const [editorReady, setEditorReady] = useState(false)
  const focusTarget = useFocusTarget<HTMLDivElement>(
    {
      area: 'chat',
      id: { kind: 'chat-composer', key: rootPath },
      onIntent: (intent) => {
        if (intent !== 'focus') return false

        const editor = editorRef.current
        if (!editor) return false

        editor.focus()
        return true
      },
    },
    editorReady,
  )
  const initialDraft = useMemo(() => readChatInputDraftPrompt(draftTarget), [draftTarget])
  const [activeCommandItemId, setActiveCommandItemId] = useState<string | null>(null)
  const imagePreparation = useImagePreparation(draftTarget)
  const { display: sessionProvider } = useProviderDisplay(sessionProviderInstanceId ?? undefined)
  const busySendDisabledReason = busy
    ? (correctionDisabledReason ??
      (sessionProvider?.driverKind === 'codex'
        ? null
        : 'Wait for the current turn to finish before sending'))
    : null
  const [validationError, setValidationError] = useState<string | null>(null)
  const [dropTargetActive, setDropTargetActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [trigger, setTrigger] = useState<ChatInputTrigger | null>(null)
  const composerDisabled = disabled || submitting
  const submissionDisabled =
    disabledReason !== null ||
    busySendDisabledReason !== null ||
    imagePreparation.preparing ||
    (!busy && pendingAction !== null)
  const visiblePendingAction = submitting ? 'sending' : pendingAction
  const statusLabel = validationError ?? imagePreparation.error ?? persistenceError ?? error
  const projectEntries = useProjectEntrySearch({
    enabled: trigger?.kind === 'mention',
    query: trigger?.kind === 'mention' ? trigger.query : '',
    rootPath,
  })
  // Only while a `/` or `$` menu is open: a fetch spawns the provider CLI, so
  // the catalog must never be a background cost of having chat on screen.
  const commandCatalog = useQuery(
    providerCommandCatalogQueryOptions({
      cwd: rootPath,
      enabled: trigger?.kind === 'skill' || trigger?.kind === 'slash-command',
      providerInstanceId: modelSelection?.providerInstanceId ?? null,
    }),
  )
  const commandMenuItems = useMemo(
    () => chatInputCommandItems(trigger, projectEntries.entries, commandCatalog.data ?? null),
    [commandCatalog.data, projectEntries.entries, trigger],
  )
  const commandMenuEmptyLabel = chatInputCommandMenuEmptyLabel(trigger)
  // Built-in slash commands answer instantly, so the menu is only "loading"
  // when nothing is on screen yet — otherwise every `/` keystroke would flash
  // a spinner over rows that are already usable.
  const commandMenuLoading =
    trigger?.kind === 'mention' ? projectEntries.isSearching : commandCatalog.isFetching
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      editorState: () => {
        // Restoring a draft must not take focus from the session list.
        $setChatInputText(initialDraft)
        $setSelection(null)
      },
      namespace: `platform-chat-input:${inputKey}`,
      nodes: CHAT_INPUT_EDITOR_NODES,
      onError: (error) => {
        throw error
      },
    }),
    [inputKey, initialDraft],
  )

  // Captures made outside chat wait in the inbox until a composer exists to
  // hold them — the terminal is often right-clicked while the sidebar is on
  // Files, so the reveal that follows is what mounts this component.
  useComposerInbox(draftTarget, editorRef, editorReady)

  useEffect(() => {
    const activeItemStillPresent = commandMenuItems.some((item) => item.id === activeCommandItemId)
    if (activeItemStillPresent) return

    setActiveCommandItemId(commandMenuItems[0]?.id ?? null)
  }, [activeCommandItemId, commandMenuItems])

  const handleEditorReady = useCallback((editor: LexicalEditor | null) => {
    editorRef.current = editor
    setEditorReady(editor !== null)
  }, [])
  function clearDraft() {
    const editor = editorRef.current
    if (editor) clearChatInputEditor(editor)

    // A correction consumes content; model and mode picks apply to the next new turn.
    if (busy) clearStoredDraftContent(draftTarget)
    else clearStoredDraft(draftTarget)
    imagePreparation.clearError()
    setValidationError(null)
    setTrigger(null)
  }

  async function handleSubmit() {
    if (disabled || submitting || submissionDisabled || imagePreparation.isPreparing()) return false

    const editor = editorRef.current
    const text = editor ? readChatInputText(editor).trim() : ''
    const draft = useChatInputDraftStore.getState().getDraft(draftTarget)
    const validation = chatSubmissionValidation(text, draft.terminalContexts)
    setValidationError(validation)
    if (validation) return false
    const attachments = chatInputUploadAttachments(draft.images)
    if (!text && attachments.length === 0 && draft.terminalContexts.length === 0) return false

    // No ready provider offers a model, so there is nothing legitimate to send.
    const selected = draft.modelSelection ?? modelSelection
    if (!selected) return false

    setSubmitting(true)
    try {
      const sent = await onSubmit({
        attachments,
        interactionMode: draft.interactionMode ?? interactionMode,
        modelSelection: selected,
        runtimeMode: draft.runtimeMode ?? runtimeMode,
        terminalContexts: draft.terminalContexts,
        text,
      })
      if (sent) clearDraft()

      return sent
    } finally {
      setSubmitting(false)
    }
  }

  const handleImageFiles = imagePreparation.prepare
  const handleRemoveImage = useCallback(
    (imageId: string) => {
      removeImage(draftTarget, imageId)
    },
    [draftTarget, removeImage],
  )
  const handleRemoveTerminalContext = useCallback(
    (contextId: string) => {
      removeTerminalContext(draftTarget, contextId)
    },
    [draftTarget, removeTerminalContext],
  )
  const handleCommandItemSelect = useCallback(
    (item: ChatInputCommandItem) => {
      const editor = editorRef.current
      if (!editor || !trigger) return

      // The trigger is React state, so it can already describe a prompt that has
      // moved on — a stale or repeated commit is refused rather than spliced in.
      const applied = replaceChatInputEditorRange(editor, {
        expectedText: trigger.text,
        rangeEnd: trigger.rangeEnd,
        rangeStart: trigger.rangeStart,
        replacement: item.replacement,
      })
      setTrigger(null)
      if (!applied) return

      useChatInputDraftStore.getState().setPrompt(draftTarget, applied.text)
      if (item.type === 'slash-command') setInteractionMode(draftTarget, item.value)

      editor.focus()
    },
    [draftTarget, setInteractionMode, trigger],
  )
  const handleCommandMenuCommit = useCallback(() => {
    const item = activeChatInputCommandItem(commandMenuItems, activeCommandItemId)
    if (!item) return false

    handleCommandItemSelect(item)
    return true
  }, [activeCommandItemId, commandMenuItems, handleCommandItemSelect])
  const handleCommandMenuMove = useCallback(
    (offset: number) => {
      const nextItem = chatInputCommandItemByOffset(commandMenuItems, activeCommandItemId, offset)
      if (!nextItem) return false

      setActiveCommandItemId(nextItem.id)
      return true
    },
    [activeCommandItemId, commandMenuItems],
  )

  /** The popover dismissed itself — a press outside it, most of the time. */
  function handleCommandMenuDismiss() {
    setTrigger(null)
  }

  function handleComposerDragOver(event: DragEvent<HTMLElement>) {
    if (composerDisabled) return
    if (!composerDropCarriesFiles(event.dataTransfer)) return

    // Without this the browser navigates to the dropped file and no drop event
    // ever reaches us.
    event.preventDefault()
    setDropTargetActive(true)
  }

  function handleComposerDragLeave(event: DragEvent<HTMLElement>) {
    if (!dragLeftComposer(event)) return

    setDropTargetActive(false)
  }

  function handleComposerDrop(event: DragEvent<HTMLElement>) {
    setDropTargetActive(false)
    if (composerDisabled) return

    // A dragged tree row before images: it is not a `Files` drag, so the image
    // path would ignore it and the editor would paste a raw absolute path.
    const mentionPath = composerDropMentionPath(event.dataTransfer, rootPath)
    if (mentionPath) {
      event.preventDefault()
      insertMention(mentionPath)
      return
    }

    const files = imageFilesFromTransfer(event.dataTransfer)
    if (files.length === 0) return

    event.preventDefault()
    handleImageFiles(files)
  }

  /**
   * Focused on the next frame, not here: focusing during the drop makes the
   * not-yet-reconciled editor sync its stale state back over the mention.
   */
  function insertMention(path: string) {
    const editor = editorRef.current
    if (!editor) return
    if (!insertChatInputMention(editor, path)) return

    useChatInputDraftStore.getState().setPrompt(draftTarget, readChatInputText(editor))
    requestAnimationFrame(() => editor.focus())
  }

  return (
    <div className='shrink-0 px-(--density-control-padding-x) py-(--density-section-gap)'>
      <ChatModelPickerProvider
        draftTarget={draftTarget}
        sessionProviderInstanceId={sessionProviderInstanceId}
        modelSelection={modelSelection}
        persistModelSelection={onPersistModelSelection}
      >
        <form
          className='relative mx-auto w-full max-w-3xl'
          onSubmit={(event) => event.preventDefault()}
        >
          {trigger ? (
            <ChatInputCommandMenu
              activeItemId={activeCommandItemId}
              emptyLabel={commandMenuEmptyLabel}
              isLoading={commandMenuLoading}
              items={commandMenuItems}
              triggerKind={trigger.kind}
              onActiveItemChange={setActiveCommandItemId}
              onDismiss={handleCommandMenuDismiss}
              onSelect={handleCommandItemSelect}
            />
          ) : null}
          <LexicalComposer initialConfig={initialConfig} key={inputKey}>
            {/* The whole composer is the drop target, not just the text area:
                dropping on the attachment strip or the action row used to do
                nothing at all. */}
            <div
              className={cn(
                'focus-ring-within border-transparent bg-background relative overflow-hidden rounded-lg border',
                // Tint rather than restate: the utility owns the border colour under
                // :focus-within, so a bare border-primary would lose to it mid-drag.
                dropTargetActive && 'border-primary [--focus-ring-color:var(--primary)]',
              )}
              ref={focusTarget.ref}
              onDragLeave={handleComposerDragLeave}
              onDragOver={handleComposerDragOver}
              onDrop={handleComposerDrop}
            >
              <ChatInputEditor
                disabled={composerDisabled}
                draftKey={draftKey}
                placeholder='Use @ to mention, / for commands.'
                rootPath={rootPath}
                trigger={trigger}
                onCommandMenuCommit={handleCommandMenuCommit}
                onCommandMenuMove={handleCommandMenuMove}
                onEditorReady={handleEditorReady}
                onImageFiles={handleImageFiles}
                onSubmitRequest={handleSubmit}
                onTriggerChange={setTrigger}
              />
              <ChatInputTerminalContextList
                contexts={terminalContexts}
                disabled={composerDisabled}
                onRemove={handleRemoveTerminalContext}
              />
              {imagePreparation.preparing ? (
                <div
                  className='text-muted-foreground flex items-center gap-2 px-3 pb-2 text-xs'
                  role='status'
                >
                  <OrbitLoader className='size-3.5' />
                  Preparing images…
                </div>
              ) : null}
              <ChatInputAttachmentList
                attachments={images}
                disabled={composerDisabled}
                onRemove={handleRemoveImage}
              />
              <ChatInputActions
                correctionDisabledReason={busySendDisabledReason}
                busy={busy}
                disabled={composerDisabled}
                disabledReason={disabledReason}
                pendingAction={visiblePendingAction}
                draftTarget={draftTarget}
                interactionMode={interactionMode}
                runtimeMode={runtimeMode}
                sendDisabled={submissionDisabled}
                statusLabel={statusLabel}
                onSelectImageFiles={handleImageFiles}
                onStop={onStop}
                onSubmit={handleSubmit}
              />
              {dropTargetActive ? (
                /* Pointer-events-none is load-bearing: an overlay that swallowed
                   the drag would fire dragleave the moment it appeared. */
                <div className='bg-primary/10 pointer-events-none absolute inset-0 flex items-center justify-center'>
                  <span className='text-muted-foreground text-xs'>Drop images to attach</span>
                </div>
              ) : null}
            </div>
          </LexicalComposer>
        </form>
      </ChatModelPickerProvider>
    </div>
  )
}

/**
 * A dragleave also fires when the pointer crosses between the composer's own
 * children, which would flicker the overlay off and on. Only a leave whose next
 * target is outside the composer really ends the drag.
 */
function dragLeftComposer(event: DragEvent<HTMLElement>) {
  const nextTarget = event.relatedTarget
  if (!(nextTarget instanceof Node)) return true

  return !event.currentTarget.contains(nextTarget)
}
