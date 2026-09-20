import { createEnvironmentRecordPersistence } from '@/lib/environments/state/record-persistence'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type {
  EnvironmentId,
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from '@workspace/contracts'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { create } from 'zustand'

import {
  chatInputDraftStorageId,
  emptyPersistedChatInputDrafts,
  readPersistedChatInputDrafts,
  writePersistedChatInputDrafts,
  type PersistedChatInputDraft,
  type DraftIdentity,
  type PersistedChatInputDraftStorage,
} from '@/features/chat/utils/draft-storage'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

const CHAT_INPUT_DRAFT_PERSIST_DEBOUNCE_MS = 300
const CHAT_INPUT_DRAFT_PERSISTENCE_ERROR = 'Chat draft could not be saved locally.'

export type ChatInputDraftTarget = {
  environmentId: EnvironmentId
  draftKey: string | null
  rootPath: string
}

export type { ChatInputAttachment } from '../utils/attachment-draft'
import type { ChatInputAttachment } from '../utils/attachment-draft'

/**
 * A captured terminal slice waiting to be sent. It carries the whole selection
 * rather than a rendered label so the composer chip and the transcript chip can
 * be the same component fed from the same shape.
 */
export type ChatInputTerminalContext = TerminalContextSelection & {
  /** Stable across re-renders and unique per capture — the same lines can be grabbed twice. */
  id: string
}

export type ChatInputDraft = {
  identity: DraftIdentity | null
  attachments: ChatInputAttachment[]
  interactionMode: InteractionMode | null
  modelSelection: ModelSelection | null
  prompt: string
  runtimeMode: RuntimeMode | null
  terminalContexts: ChatInputTerminalContext[]
  updatedAt: string | null
}

type ChatInputDraftState = {
  draftsByKey: Record<string, ChatInputDraft>
  preparingAttachmentsByKey: Record<string, number>
  persistenceError: string | null
}

type ChatInputDraftActions = {
  setIdentity: (target: ChatInputDraftTarget, identity: DraftIdentity | null) => void
  restoreContent: (
    target: ChatInputDraftTarget,
    content: Pick<ChatInputDraft, 'prompt' | 'attachments' | 'terminalContexts'>,
  ) => void
  changeAttachmentPreparation: (target: ChatInputDraftTarget, delta: 1 | -1) => void
  addAttachments: (
    target: ChatInputDraftTarget,
    attachments: readonly ChatInputAttachment[],
  ) => number
  addTerminalContexts: (
    target: ChatInputDraftTarget,
    contexts: readonly ChatInputTerminalContext[],
  ) => void
  updateAttachment: (
    target: ChatInputDraftTarget,
    id: string,
    update: Partial<ChatInputAttachment>,
  ) => boolean
  clearDraft: (target: ChatInputDraftTarget) => void
  clearDraftContent: (target: ChatInputDraftTarget) => void
  flush: () => boolean
  getDraft: (target: ChatInputDraftTarget) => ChatInputDraft
  removeAttachment: (target: ChatInputDraftTarget, imageId: string) => void
  removeTerminalContext: (target: ChatInputDraftTarget, contextId: string) => void
  setInteractionMode: (
    target: ChatInputDraftTarget,
    interactionMode: InteractionMode | null,
  ) => void
  setModelSelection: (target: ChatInputDraftTarget, modelSelection: ModelSelection | null) => void
  setPrompt: (target: ChatInputDraftTarget, prompt: string) => void
  setRuntimeMode: (target: ChatInputDraftTarget, runtimeMode: RuntimeMode | null) => void
}

export type ChatInputDraftStore = ChatInputDraftState & ChatInputDraftActions

const EMPTY_ATTACHMENTS: ChatInputAttachment[] = []
const EMPTY_TERMINAL_CONTEXTS: ChatInputTerminalContext[] = []
const EMPTY_CHAT_INPUT_DRAFT: ChatInputDraft = {
  identity: null,
  attachments: EMPTY_ATTACHMENTS,
  interactionMode: null,
  modelSelection: null,
  prompt: '',
  runtimeMode: null,
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  updatedAt: null,
}

const draftAdapters = new Map<EnvironmentId, ScopedStorage>()

const draftPersistence = createEnvironmentRecordPersistence<PersistedChatInputDraft>({
  read: (storage) => readPersistedChatInputDrafts(storage).draftsByKey,
  write: (storage, draftsByKey) =>
    writePersistedChatInputDrafts(storage, {
      ...readPersistedChatInputDrafts(storage),
      draftsByKey: { ...draftsByKey },
    }),
})

const draftPersist = new Debouncer(() => flushChatInputDraftStorage(), {
  wait: CHAT_INPUT_DRAFT_PERSIST_DEBOUNCE_MS,
})

export const useChatInputDraftStore = create<ChatInputDraftStore>((set, get) => ({
  ...createInitialChatInputDraftState(),
  setIdentity: (target, identity) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => withDraftPatch(draft, { identity })),
    )
    draftPersist.maybeExecute()
  },
  restoreContent: (target, content) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) =>
        withDraftPatch(draft, {
          prompt: [content.prompt, draft.prompt].filter(Boolean).join('\n\n'),
          // Capacity was checked before rewind; preserve both if another editor changed the draft.
          attachments: content.attachments.concat(draft.attachments),
          terminalContexts: content.terminalContexts.concat(draft.terminalContexts),
        }),
      ),
    )
    draftPersist.maybeExecute()
  },
  changeAttachmentPreparation: (target, delta) => {
    const key = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
    if (!key) return
    set((state) => {
      const preparingAttachmentsByKey = { ...state.preparingAttachmentsByKey }
      const count = Math.max(0, (preparingAttachmentsByKey[key] ?? 0) + delta)
      if (count === 0) delete preparingAttachmentsByKey[key]
      else preparingAttachmentsByKey[key] = count
      return { preparingAttachmentsByKey }
    })
  },
  updateAttachment: (target, id, update) => {
    const draft = get().getDraft(target)
    if (!draft.attachments.some((image) => image.id === id)) return false
    set((state) =>
      updateDraftForTarget(state, target, (current) =>
        withDraftPatch(current, {
          attachments: current.attachments.map((image) =>
            image.id === id ? ({ ...image, ...update } as ChatInputAttachment) : image,
          ),
        }),
      ),
    )
    return true
  },
  addAttachments: (target, attachments) => {
    const accepted = attachments.slice(
      0,
      Math.max(0, MAX_CHAT_ATTACHMENTS - get().getDraft(target).attachments.length),
    )
    set((state) =>
      updateDraftForTarget(state, target, (draft) => addAttachmentsToDraft(draft, accepted)),
    )
    draftPersist.maybeExecute()
    return accepted.length
  },
  addTerminalContexts: (target, contexts) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => addTerminalContextsToDraft(draft, contexts)),
    )
    draftPersist.maybeExecute()
  },
  clearDraft: (target) => {
    set((state) => removeDraftForTarget(state, target))
    draftPersist.maybeExecute()
  },
  clearDraftContent: (target) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) =>
        withDraftPatch(draft, {
          prompt: '',
          attachments: EMPTY_ATTACHMENTS,
          terminalContexts: EMPTY_TERMINAL_CONTEXTS,
        }),
      ),
    )
    draftPersist.maybeExecute()
  },
  flush: () => flushChatInputDraftStorage(),
  getDraft: (target) => chatInputDraftForTarget(get(), target),
  removeAttachment: (target, imageId) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => removeAttachmentFromDraft(draft, imageId)),
    )
    draftPersist.maybeExecute()
  },
  removeTerminalContext: (target, contextId) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) =>
        removeTerminalContextFromDraft(draft, contextId),
      ),
    )
    draftPersist.maybeExecute()
  },
  setInteractionMode: (target, interactionMode) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => withDraftPatch(draft, { interactionMode })),
    )
    draftPersist.maybeExecute()
  },
  setModelSelection: (target, modelSelection) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => withDraftPatch(draft, { modelSelection })),
    )
    draftPersist.maybeExecute()
  },
  setPrompt: (target, prompt) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => withDraftPatch(draft, { prompt })),
    )
    draftPersist.maybeExecute()
  },
  setRuntimeMode: (target, runtimeMode) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => withDraftPatch(draft, { runtimeMode })),
    )
    draftPersist.maybeExecute()
  },
}))

export function selectChatInputDraftHasContent(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  const draft = chatInputDraftForTarget(state, target)
  return (
    draft.prompt.trim().length > 0 ||
    draft.attachments.length > 0 ||
    draft.terminalContexts.length > 0
  )
}

export function selectChatInputDraftAttachments(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  return chatInputDraftForTarget(state, target).attachments
}

export function selectChatInputDraftTerminalContexts(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  return chatInputDraftForTarget(state, target).terminalContexts
}

export function selectChatInputDraftInteractionMode(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  return chatInputDraftForTarget(state, target).interactionMode
}

export function selectChatInputDraftRuntimeMode(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  return chatInputDraftForTarget(state, target).runtimeMode
}

export function readChatInputDraftPrompt(target: ChatInputDraftTarget) {
  return useChatInputDraftStore.getState().getDraft(target).prompt
}

export function flushChatInputDraftStorage() {
  draftPersist.cancel()

  const written = draftPersistence.persist(
    persistedStorageFromState(useChatInputDraftStore.getState()).draftsByKey,
  )
  if (!written) {
    useChatInputDraftStore.setState({ persistenceError: CHAT_INPUT_DRAFT_PERSISTENCE_ERROR })
    return false
  }
  clearDraftPersistenceError()
  return true
}

export function hydrateChatInputDraftStoreFromStorage(storage: ScopedStorage) {
  draftAdapters.set(storage.environmentId, storage)
  const draftsByKey = hydrateDrafts({
    ...emptyPersistedChatInputDrafts(),
    draftsByKey: draftPersistence.hydrate(storage),
  })
  useChatInputDraftStore.setState((state) => ({
    draftsByKey: { ...state.draftsByKey, ...draftsByKey },
  }))
}

export function recoverableDraft(environmentId: EnvironmentId, id: string) {
  return (
    Object.entries(useChatInputDraftStore.getState().draftsByKey).find(
      ([key, draft]) => key.startsWith(`${environmentId}:`) && draft.identity?.id === id,
    )?.[1] ?? null
  )
}

export function discardRecoverableDraft(target: ChatInputDraftTarget) {
  const storage = draftAdapters.get(target.environmentId)
  if (!storage) return null
  const state = useChatInputDraftStore.getState()
  const draft = state.getDraft(target)
  const next = removeDraftForTarget(state, target)
  const document = persistedStorageFromState(next)
  document.stashEntries = readPersistedChatInputDrafts(storage).stashEntries
  document.draftsByKey = Object.fromEntries(
    Object.entries(document.draftsByKey).filter(([key]) =>
      key.startsWith(`${target.environmentId}:`),
    ),
  )
  if (writePersistedChatInputDrafts(storage, document).status !== 'written') return null
  useChatInputDraftStore.setState(next)
  return draft.attachments
}

export function commitComposerTransfer(
  storage: ScopedStorage,
  stashEntries: import('../utils/draft-storage').PromptStashEntry[],
  transfer?: {
    target: ChatInputDraftTarget
    expected: ChatInputDraft
    content: Pick<ChatInputDraft, 'prompt' | 'attachments' | 'terminalContexts'>
  },
) {
  const state = useChatInputDraftStore.getState()
  if (transfer && state.getDraft(transfer.target) !== transfer.expected) return false
  const next = transfer
    ? updateDraftForTarget(state, transfer.target, (draft) =>
        withDraftPatch(draft, transfer.content),
      )
    : state
  const document = persistedStorageFromState({ ...state, ...next })
  document.draftsByKey = Object.fromEntries(
    Object.entries(document.draftsByKey).filter(([key]) =>
      key.startsWith(`${storage.environmentId}:`),
    ),
  )
  document.stashEntries = stashEntries
  if (writePersistedChatInputDrafts(storage, document).status !== 'written') return false
  if (transfer) useChatInputDraftStore.setState(next)
  return true
}

export function resetChatInputDraftStore() {
  draftPersist.cancel()
  useChatInputDraftStore.setState({
    draftsByKey: {},
    preparingAttachmentsByKey: {},
    persistenceError: null,
  })
}

function createInitialChatInputDraftState(): ChatInputDraftState {
  return {
    draftsByKey: {},
    preparingAttachmentsByKey: {},
    persistenceError: null,
  }
}

export function chatInputAttachmentsPreparing(
  state: ChatInputDraftState,
  target: ChatInputDraftTarget,
) {
  const key = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
  return key !== null && (state.preparingAttachmentsByKey[key] ?? 0) > 0
}

function chatInputDraftForTarget(
  state: Pick<ChatInputDraftState, 'draftsByKey'>,
  target: ChatInputDraftTarget,
) {
  const draftId = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
  if (!draftId) return EMPTY_CHAT_INPUT_DRAFT

  return state.draftsByKey[draftId] ?? EMPTY_CHAT_INPUT_DRAFT
}

function updateDraftForTarget(
  state: ChatInputDraftState,
  target: ChatInputDraftTarget,
  update: (draft: ChatInputDraft) => ChatInputDraft,
): ChatInputDraftState {
  const draftId = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
  if (!draftId) return state

  const draft = state.draftsByKey[draftId] ?? EMPTY_CHAT_INPUT_DRAFT
  const nextDraft = update(draft)
  if (nextDraft === draft) return state
  if (isEmptyChatInputDraft(nextDraft)) return removeDraftById(state, draftId)

  return {
    ...state,
    draftsByKey: {
      ...state.draftsByKey,
      [draftId]: nextDraft,
    },
  }
}

function removeDraftForTarget(
  state: ChatInputDraftState,
  target: ChatInputDraftTarget,
): ChatInputDraftState {
  const draftId = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
  if (!draftId) return state

  return removeDraftById(state, draftId)
}

function removeDraftById(state: ChatInputDraftState, draftId: string): ChatInputDraftState {
  if (!state.draftsByKey[draftId]) return state

  const { [draftId]: _removed, ...draftsByKey } = state.draftsByKey
  return {
    ...state,
    draftsByKey,
  }
}

function withDraftPatch(draft: ChatInputDraft, patch: Partial<ChatInputDraft>): ChatInputDraft {
  const nextDraft = {
    ...draft,
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  return draftsEqual(draft, nextDraft) ? draft : nextDraft
}

function addAttachmentsToDraft(
  draft: ChatInputDraft,
  attachments: readonly ChatInputAttachment[],
): ChatInputDraft {
  if (attachments.length === 0) return draft

  return withDraftPatch(draft, {
    attachments: draft.attachments.concat(attachments),
  })
}

function removeAttachmentFromDraft(draft: ChatInputDraft, imageId: string): ChatInputDraft {
  const attachments = draft.attachments.filter((image) => image.id !== imageId)
  if (attachments.length === draft.attachments.length) return draft

  return withDraftPatch(draft, { attachments })
}

/**
 * Deduped by id because the inbox drain and a React strict-mode double-invoke
 * can both hand over the same capture.
 */
function addTerminalContextsToDraft(
  draft: ChatInputDraft,
  contexts: readonly ChatInputTerminalContext[],
): ChatInputDraft {
  const seen = new Set(draft.terminalContexts.map((context) => context.id))
  const added = contexts.filter((context) => !seen.has(context.id))
  if (added.length === 0) return draft

  return withDraftPatch(draft, {
    terminalContexts: draft.terminalContexts.concat(added),
  })
}

function removeTerminalContextFromDraft(draft: ChatInputDraft, contextId: string): ChatInputDraft {
  const terminalContexts = draft.terminalContexts.filter((context) => context.id !== contextId)
  if (terminalContexts.length === draft.terminalContexts.length) return draft

  return withDraftPatch(draft, { terminalContexts })
}

function isEmptyChatInputDraft(draft: ChatInputDraft) {
  if (draft.identity) return false
  if (draft.prompt.trim()) return false
  if (draft.attachments.length > 0) return false
  if (draft.terminalContexts.length > 0) return false
  if (draft.modelSelection) return false
  if (draft.runtimeMode) return false

  return !draft.interactionMode
}

function draftsEqual(left: ChatInputDraft, right: ChatInputDraft) {
  return (
    left.prompt === right.prompt &&
    left.attachments === right.attachments &&
    left.terminalContexts === right.terminalContexts &&
    left.modelSelection === right.modelSelection &&
    left.identity === right.identity &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode
  )
}

function clearDraftPersistenceError() {
  if (!useChatInputDraftStore.getState().persistenceError) return

  useChatInputDraftStore.setState({ persistenceError: null })
}

function hydrateDrafts(storage: PersistedChatInputDraftStorage) {
  return Object.fromEntries(
    Object.entries(storage.draftsByKey).map(([draftId, draft]) => [draftId, hydrateDraft(draft)]),
  )
}

function hydrateDraft(draft: PersistedChatInputDraft): ChatInputDraft {
  return {
    identity: draft.identity,
    // Image bytes never reach storage, so a stored draft has no preview source:
    // restoring its attachments would only render broken thumbnails.
    attachments: draft.attachments.map((entry) => ({
      ...entry,
      upload:
        entry.upload.status === 'uploading' ||
        (entry.upload.status === 'ready' && Date.parse(entry.upload.expiresAt) <= Date.now())
          ? {
              status: 'failed' as const,
              message: 'Upload interrupted or expired. Retry to restore the saved file.',
            }
          : entry.upload,
    })),
    interactionMode: draft.interactionMode,
    modelSelection: draft.modelSelection,
    prompt: draft.prompt,
    runtimeMode: draft.runtimeMode,
    terminalContexts: draft.terminalContexts,
    updatedAt: draft.updatedAt,
  }
}

function persistedStorageFromState(state: ChatInputDraftState): PersistedChatInputDraftStorage {
  const storage = emptyPersistedChatInputDrafts()

  for (const [draftId, draft] of Object.entries(state.draftsByKey)) {
    if (isEmptyChatInputDraft(draft)) continue

    storage.draftsByKey[draftId] = persistedDraft(draft)
  }

  return storage
}

function persistedDraft(draft: ChatInputDraft): PersistedChatInputDraft {
  return {
    identity: draft.identity,
    attachments: draft.attachments.flatMap(({ dataUrl: _bytes, ...entry }) =>
      entry.upload
        ? [
            {
              ...entry,
              previewUrl: /^(data|blob):/.test(entry.previewUrl) ? '' : entry.previewUrl,
              upload: entry.upload,
            },
          ]
        : [],
    ),
    interactionMode: draft.interactionMode,
    modelSelection: draft.modelSelection,
    prompt: draft.prompt,
    runtimeMode: draft.runtimeMode,
    terminalContexts: draft.terminalContexts,
    updatedAt: draft.updatedAt,
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    flushChatInputDraftStorage()
  })
}
