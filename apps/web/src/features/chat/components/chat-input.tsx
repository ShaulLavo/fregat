import { ReviewDraftBar } from '@/features/chat/components/review-draft-bar'
import { useReviewDraft } from '@/lib/review-draft/hooks/use-review-draft'
import { removeReviewComments } from '@/lib/review-draft/state/store'
import { withReviewComments } from '@/lib/review-draft/utils/prompt'
import { ActiveFileChip } from '@/features/chat/components/active-file-chip'
import { useActiveFileChip } from '@/features/chat/hooks/use-active-file-chip'
import { withActiveFileMention } from '@/features/chat/utils/active-file-mention'
import { useSettingValue } from '@/hooks/use-setting-value'
import { resolveComposerInteractionMode } from '@workspace/client-core/chat/composer-interaction'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { useQuery } from '@tanstack/react-query'
import type {
  InteractionMode,
  ModelSelection,
  ProviderInstanceId,
  RuntimeMode,
} from '@workspace/contracts'
import { $setSelection, type LexicalEditor } from 'lexical'
import { use, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
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
  filesFromTransfer,
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
import { ComposerRootsContext } from '@/lib/composer-attach/providers/roots-context'
import { useAttachmentPreparation } from '@/features/chat/hooks/use-attachment-preparation'
import { useProvider } from '@/features/chat/hooks/use-provider'
import { chatSubmissionValidation } from '@/features/chat/utils/submission-validation'
import { Spinner } from '@workspace/ui/components/spinner'
import { ChatModelPickerProvider } from '../providers/model-picker-provider'
import {
  readChatInputDraftPrompt,
  selectChatInputDraftAttachments,
  selectChatInputDraftTerminalContexts,
  useChatInputDraftStore,
  type ChatInputDraftStore,
  type ChatInputDraftTarget,
} from '../state/chat-input-draft-store'
import { ChatInputAttachmentList } from './chat-input-attachment-list'
import { ChatInputActions } from './chat-input-actions'
import { ChatInputCommandMenu } from './chat-input-command-menu'
import { ChatInputEditor } from './chat-input-editor'
import { ChatInputUltrathinkPlugin } from './chat-input-ultrathink-plugin'
import { ChatInputTerminalContextList } from './chat-input-terminal-context-list'
import { CHAT_INPUT_EDITOR_NODES } from './chat-input-mention-node'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type { ComposerPendingAction } from '@/features/chat/utils/composer-state'

import type { ChatInputSubmitPayload, ChatInputSubmitResult } from '../utils/composed-message'
import { sentDraftStillCurrent } from '@/features/chat/utils/sent-draft'

export function ChatInput({
  busy,
  correctionDisabledReason = null,
  disabled,
  disabledReason = null,
  draftKey,
  error,
  footer = null,
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
  /** Under the composer box, aligned with it: where a draft says where it will run. */
  footer?: ReactNode
  interactionMode: InteractionMode
  modelSelection: ModelSelection | null
  sessionProviderInstanceId?: ProviderInstanceId | null
  onPersistModelSelection: (modelSelection: ModelSelection) => void
  onStop: () => void
  onSubmit: (payload: ChatInputSubmitPayload, alternate?: boolean) => Promise<ChatInputSubmitResult>
  rootPath: string
  runtimeMode: RuntimeMode
}) {
  const environmentId = useEnvironmentId()
  const inputKey = `${environmentId}:${rootPath}:${draftKey}`
  // Manual memo: the store keys on this value, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const draftTarget: ChatInputDraftTarget = useMemo(
    () => ({ environmentId, draftKey, rootPath }),
    [draftKey, environmentId, rootPath],
  )
  // Manual memo: the store keys on this selector's identity, and the compiler's cache is a cache,
  // not an identity guarantee — a recompute resubscribes the draft store every render.
  const imagesSelector = useMemo(
    () => (state: ChatInputDraftStore) => selectChatInputDraftAttachments(state, draftTarget),
    [draftTarget],
  )
  // Manual memo: the store keys on this selector's identity, and the compiler's cache is a cache,
  // not an identity guarantee — a recompute resubscribes the draft store every render.
  const terminalContextsSelector = useMemo(
    () => (state: ChatInputDraftStore) => selectChatInputDraftTerminalContexts(state, draftTarget),
    [draftTarget],
  )
  const planModeEnabled = useSettingValue('chat.planModeEnabled')
  const followUpBehavior = useSettingValue('chat.followUpBehavior')
  const draftProviderId = useChatInputDraftStore(
    (state) => state.getDraft(draftTarget).modelSelection?.providerInstanceId,
  )
  const modeProvider = useProvider(draftProviderId ?? modelSelection?.providerInstanceId)
  const planMode = resolveComposerInteractionMode({
    planModeEnabled,
    provider: modeProvider,
    interactionMode,
  })
  const images = useChatInputDraftStore(imagesSelector)
  const terminalContexts = useChatInputDraftStore(terminalContextsSelector)
  const activeFile = useActiveFileChip(rootPath)
  const aliasRoots = use(ComposerRootsContext)
  const reviewComments = useReviewDraft({ environmentId, rootPaths: [rootPath, ...aliasRoots] })
  const persistenceError = useChatInputDraftStore((store) => store.persistenceError)
  const clearStoredDraft = useChatInputDraftStore((store) => store.clearDraft)
  const clearStoredDraftContent = useChatInputDraftStore((store) => store.clearDraftContent)
  const removeTerminalContext = useChatInputDraftStore((store) => store.removeTerminalContext)
  const setInteractionMode = useChatInputDraftStore((store) => store.setInteractionMode)
  const editorRef = useRef<LexicalEditor | null>(null)
  // State as well as the ref: the inbox only splices text once a caret exists,
  // and a ref cannot wake the effect that is waiting for one.
  const [editorReady, setEditorReady] = useState(false)
  const { ref: focusTargetRef } = useFocusTarget<HTMLDivElement>(
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
  const initialDraft = readChatInputDraftPrompt(draftTarget)
  const [activeCommandItemId, setActiveCommandItemId] = useState<string | null>(null)
  const imagePreparation = useAttachmentPreparation(draftTarget)
  const sessionProvider = useProvider(sessionProviderInstanceId ?? undefined)
  const steerDisabledReason = busy
    ? (correctionDisabledReason ??
      (sessionProvider?.driverKind === 'codex'
        ? null
        : 'Wait for the current turn to finish before sending'))
    : null
  const busySendDisabledReason = followUpBehavior === 'queue' ? null : steerDisabledReason
  const [validationError, setValidationError] = useState<string | null>(null)
  const [dropTargetActive, setDropTargetActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [trigger, setTrigger] = useState<ChatInputTrigger | null>(null)
  const composerDisabled = disabled || submitting
  const submissionDisabled =
    disabledReason !== null || imagePreparation.preparing || (!busy && pendingAction !== null)
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
    () =>
      chatInputCommandItems(
        trigger,
        projectEntries.entries,
        commandCatalog.data ?? null,
        planMode.enabled,
      ),
    [commandCatalog.data, projectEntries.entries, trigger, planMode.enabled],
  )
  const commandMenuEmptyLabel = chatInputCommandMenuEmptyLabel(trigger)
  // Built-in slash commands answer instantly, so the menu is only "loading"
  // when nothing is on screen yet — otherwise every `/` keystroke would flash
  // a spinner over rows that are already usable.
  const commandMenuLoading =
    trigger?.kind === 'mention' ? projectEntries.isSearching : commandCatalog.isFetching
  const initialConfig: InitialConfigType = {
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
  }

  // Captures made outside chat wait in the inbox until a composer exists to
  // hold them — the terminal is often right-clicked while the sidebar is on
  // Files, so the reveal that follows is what mounts this component.
  useComposerInbox(draftTarget, editorRef, editorReady, aliasRoots)

  useEffect(() => {
    const activeItemStillPresent = commandMenuItems.some((item) => item.id === activeCommandItemId)
    if (activeItemStillPresent) return

    setActiveCommandItemId(commandMenuItems[0]?.id ?? null)
  }, [activeCommandItemId, commandMenuItems])

  const handleEditorReady = (editor: LexicalEditor | null) => {
    editorRef.current = editor
    setEditorReady(editor !== null)
  }
  function clearDraft(editor: LexicalEditor | null, keepDraft: boolean) {
    if (editor && editorRef.current === editor) clearChatInputEditor(editor)

    // A correction or a background start consumes content; the picks apply to the next turn.
    if (busy || keepDraft) clearStoredDraftContent(draftTarget)
    else clearStoredDraft(draftTarget)
    if (editorRef.current !== editor) return
    imagePreparation.clearError()
    setValidationError(null)
    setTrigger(null)
  }

  async function handleSubmit(alternate = false) {
    if (disabled || submitting || submissionDisabled || imagePreparation.isPreparing()) return false

    const queuesFollowUp = busy && (followUpBehavior === 'queue') !== alternate
    if (busy && !queuesFollowUp && steerDisabledReason !== null) return false

    const editor = editorRef.current
    const typed = editor ? readChatInputText(editor).trim() : ''
    const text = withReviewComments(typed, reviewComments)
    const draft = useChatInputDraftStore.getState().getDraft(draftTarget)
    const validation = chatSubmissionValidation(text, draft.terminalContexts)
    setValidationError(validation)
    if (validation) return false
    const attachments = chatInputUploadAttachments(draft.attachments)
    if (!text && attachments.length === 0 && draft.terminalContexts.length === 0) return false

    // No ready provider offers a model, so there is nothing legitimate to send.
    const selected = draft.modelSelection ?? modelSelection
    if (!selected) return false

    setSubmitting(true)
    try {
      const result = await onSubmit(
        {
          attachments,
          interactionMode: resolveComposerInteractionMode({
            planModeEnabled,
            provider:
              modeProvider?.providerInstanceId === selected.providerInstanceId
                ? modeProvider
                : undefined,
            interactionMode: draft.interactionMode ?? interactionMode,
          }).interactionMode,
          modelSelection: selected,
          runtimeMode: draft.runtimeMode ?? runtimeMode,
          terminalContexts: draft.terminalContexts,
          text: withActiveFileMention(text, activeFile.path),
        },
        alternate,
      )
      if (result !== 'rejected') removeReviewComments(reviewComments.map((comment) => comment.id))
      if (
        sentDraftStillCurrent(
          result,
          useChatInputDraftStore.getState().getDraft(draftTarget),
          draft,
        )
      ) {
        // A navigated attachment mutation now belongs to the new editor; its old upload can expire.
        if (result !== 'queued' && editorRef.current === editor) imagePreparation.clearSent()
        clearDraft(editor, result === 'started')
      }
      setSubmitting(false)

      return result !== 'rejected'
    } catch (error) {
      // Not `finally`: the compiler refuses the whole component over one.
      setSubmitting(false)
      throw error
    }
  }

  const handleImageFiles = imagePreparation.prepare
  const handleRemoveImage = imagePreparation.remove
  const handleRemoveTerminalContext = (contextId: string) => {
    removeTerminalContext(draftTarget, contextId)
  }
  const handleCommandItemSelect = (item: ChatInputCommandItem) => {
    const editor = editorRef.current
    if (!editor || !trigger) return
    if (item.type === 'slash-command' && !planMode.enabled) return

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
  }
  const handleCommandMenuCommit = () => {
    const item = activeChatInputCommandItem(commandMenuItems, activeCommandItemId)
    if (!item) return false

    handleCommandItemSelect(item)
    return true
  }
  const handleCommandMenuMove = (offset: number) => {
    const nextItem = chatInputCommandItemByOffset(commandMenuItems, activeCommandItemId, offset)
    if (!nextItem) return false

    setActiveCommandItemId(nextItem.id)
    return true
  }

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

    const files = filesFromTransfer(event.dataTransfer)
    if (files.length === 0) return

    event.preventDefault()
    handleImageFiles(files)
  }

  function insertMention(path: string) {
    const editor = editorRef.current
    if (!editor) return
    if (!insertChatInputMention(editor, path, { focus: true })) return

    useChatInputDraftStore.getState().setPrompt(draftTarget, readChatInputText(editor))
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
                'focus-ring-within border-transparent bg-input/30 relative overflow-hidden rounded-lg border',
                // Tint rather than restate: the utility owns the border colour under
                // :focus-within, so a bare border-primary would lose to it mid-drag.
                dropTargetActive && 'border-primary [--focus-ring-color:var(--primary)]',
              )}
              ref={focusTargetRef}
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
              <ChatInputUltrathinkPlugin />
              <ReviewDraftBar comments={reviewComments} disabled={composerDisabled} />
              {activeFile.path ? (
                <ActiveFileChip
                  disabled={composerDisabled}
                  path={activeFile.path}
                  onRemove={activeFile.remove}
                />
              ) : null}
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
                  <Spinner size='xs' />
                  Preparing images…
                </div>
              ) : null}
              <ChatInputAttachmentList
                attachments={images}
                disabled={composerDisabled}
                onRemove={handleRemoveImage}
                onRetry={imagePreparation.retry}
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
                sendDisabled={submissionDisabled || busySendDisabledReason !== null}
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
          {footer}
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
