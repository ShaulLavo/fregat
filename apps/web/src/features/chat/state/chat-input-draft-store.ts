import { createEnvironmentRecordPersistence } from '@/lib/environments/state/record-persistence'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type {
  ChatAttachment,
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

export type ChatInputImageAttachment = ChatAttachment & {
  dataUrl: string
  previewUrl: string
}

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
  images: ChatInputImageAttachment[]
  interactionMode: InteractionMode | null
  modelSelection: ModelSelection | null
  prompt: string
  runtimeMode: RuntimeMode | null
  terminalContexts: ChatInputTerminalContext[]
  updatedAt: string | null
}

type ChatInputDraftState = {
  draftsByKey: Record<string, ChatInputDraft>
  preparingImagesByKey: Record<string, number>
  persistenceError: string | null
}

type ChatInputDraftActions = {
  changeImagePreparation: (target: ChatInputDraftTarget, delta: 1 | -1) => void
  addImages: (target: ChatInputDraftTarget, images: readonly ChatInputImageAttachment[]) => number
  addTerminalContexts: (
    target: ChatInputDraftTarget,
    contexts: readonly ChatInputTerminalContext[],
  ) => void
  clearDraft: (target: ChatInputDraftTarget) => void
  clearDraftContent: (target: ChatInputDraftTarget) => void
  flush: () => boolean
  getDraft: (target: ChatInputDraftTarget) => ChatInputDraft
  removeImage: (target: ChatInputDraftTarget, imageId: string) => void
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

const EMPTY_IMAGES: ChatInputImageAttachment[] = []
const EMPTY_TERMINAL_CONTEXTS: ChatInputTerminalContext[] = []
const EMPTY_CHAT_INPUT_DRAFT: ChatInputDraft = {
  images: EMPTY_IMAGES,
  interactionMode: null,
  modelSelection: null,
  prompt: '',
  runtimeMode: null,
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  updatedAt: null,
}

const draftPersistence = createEnvironmentRecordPersistence<PersistedChatInputDraft>({
  read: (storage) => readPersistedChatInputDrafts(storage).draftsByKey,
  write: (storage, draftsByKey) =>
    writePersistedChatInputDrafts(storage, {
      ...emptyPersistedChatInputDrafts(),
      draftsByKey: { ...draftsByKey },
    }),
})

const draftPersist = new Debouncer(() => flushChatInputDraftStorage(), {
  wait: CHAT_INPUT_DRAFT_PERSIST_DEBOUNCE_MS,
})

export const useChatInputDraftStore = create<ChatInputDraftStore>((set, get) => ({
  ...createInitialChatInputDraftState(),
  changeImagePreparation: (target, delta) => {
    const key = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
    if (!key) return
    set((state) => {
      const preparingImagesByKey = { ...state.preparingImagesByKey }
      const count = Math.max(0, (preparingImagesByKey[key] ?? 0) + delta)
      if (count === 0) delete preparingImagesByKey[key]
      else preparingImagesByKey[key] = count
      return { preparingImagesByKey }
    })
  },
  addImages: (target, images) => {
    const accepted = images.slice(
      0,
      Math.max(0, MAX_CHAT_ATTACHMENTS - get().getDraft(target).images.length),
    )
    set((state) =>
      updateDraftForTarget(state, target, (draft) => addImagesToDraft(draft, accepted)),
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
          images: EMPTY_IMAGES,
          terminalContexts: EMPTY_TERMINAL_CONTEXTS,
        }),
      ),
    )
    draftPersist.maybeExecute()
  },
  flush: () => flushChatInputDraftStorage(),
  getDraft: (target) => chatInputDraftForTarget(get(), target),
  removeImage: (target, imageId) => {
    set((state) =>
      updateDraftForTarget(state, target, (draft) => removeImageFromDraft(draft, imageId)),
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

export function selectChatInputDraftImages(
  state: ChatInputDraftStore,
  target: ChatInputDraftTarget,
) {
  return chatInputDraftForTarget(state, target).images
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

  try {
    draftPersistence.persist(
      persistedStorageFromState(useChatInputDraftStore.getState()).draftsByKey,
    )
    clearDraftPersistenceError()
    return true
  } catch {
    useChatInputDraftStore.setState({ persistenceError: CHAT_INPUT_DRAFT_PERSISTENCE_ERROR })
    return false
  }
}

export function hydrateChatInputDraftStoreFromStorage(storage: ScopedStorage) {
  const draftsByKey = hydrateDrafts({
    ...emptyPersistedChatInputDrafts(),
    draftsByKey: draftPersistence.hydrate(storage),
  })
  useChatInputDraftStore.setState((state) => ({
    draftsByKey: { ...state.draftsByKey, ...draftsByKey },
  }))
}

export function resetChatInputDraftStore() {
  draftPersist.cancel()
  useChatInputDraftStore.setState({
    draftsByKey: {},
    preparingImagesByKey: {},
    persistenceError: null,
  })
}

function createInitialChatInputDraftState(): ChatInputDraftState {
  return {
    draftsByKey: {},
    preparingImagesByKey: {},
    persistenceError: null,
  }
}

export function chatInputImagesPreparing(state: ChatInputDraftState, target: ChatInputDraftTarget) {
  const key = chatInputDraftStorageId(target.environmentId, target.rootPath, target.draftKey)
  return key !== null && (state.preparingImagesByKey[key] ?? 0) > 0
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

function addImagesToDraft(
  draft: ChatInputDraft,
  images: readonly ChatInputImageAttachment[],
): ChatInputDraft {
  if (images.length === 0) return draft

  return withDraftPatch(draft, {
    images: draft.images.concat(images),
  })
}

function removeImageFromDraft(draft: ChatInputDraft, imageId: string): ChatInputDraft {
  const images = draft.images.filter((image) => image.id !== imageId)
  if (images.length === draft.images.length) return draft

  return withDraftPatch(draft, { images })
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
  if (draft.prompt.trim()) return false
  if (draft.images.length > 0) return false
  if (draft.terminalContexts.length > 0) return false
  if (draft.modelSelection) return false
  if (draft.runtimeMode) return false

  return !draft.interactionMode
}

function draftsEqual(left: ChatInputDraft, right: ChatInputDraft) {
  return (
    left.prompt === right.prompt &&
    left.images === right.images &&
    left.terminalContexts === right.terminalContexts &&
    left.modelSelection === right.modelSelection &&
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
    // Image bytes never reach storage, so a stored draft has no preview source:
    // restoring its attachments would only render broken thumbnails.
    images: EMPTY_IMAGES,
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
