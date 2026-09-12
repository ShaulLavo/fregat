import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { afterEach, beforeEach } from 'vitest'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import {
  CHAT_INPUT_DRAFT_STORAGE_KEY,
  chatInputDraftStorageId,
} from '@/features/chat/utils/draft-storage'
import {
  flushChatInputDraftStorage,
  hydrateChatInputDraftStoreFromStorage,
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
  type ChatInputImageAttachment,
} from '@/features/chat/state/chat-input-draft-store'

// Browsers cap localStorage around 5 MB of UTF-16 code units; a single pasted
// screenshot is a few MB once base64-encoded, so two of them used to overflow it.
const LOCAL_STORAGE_QUOTA_CHARS = 5 * 1024 * 1024
const SCREENSHOT_BASE64_CHARS = 3 * 1024 * 1024

const STORE = new Map<string, string>()
const TARGET: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: 'ad686244-5b2e-59be-805f-ef86eac80feb',
  rootPath: '/repo',
}

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: quotaLimitedLocalStorage(),
  })
  resetChatInputDraftStore()
  hydrateChatInputDraftStoreFromStorage(testScopedStorage)
})

afterEach(() => {
  resetChatInputDraftStore()
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('persists a draft with images without writing the image bytes', () => {
  useChatInputDraftStore.getState().setPrompt(TARGET, 'Explain this screenshot')
  useChatInputDraftStore.getState().addImages(TARGET, [imageAttachment('image-1')])

  expect(flushChatInputDraftStorage()).toBe(true)

  const raw = testScopedStorage.getItem(CHAT_INPUT_DRAFT_STORAGE_KEY) ?? ''
  expect(raw).not.toContain('base64')
  expect(JSON.parse(raw).version).toBe(2)
  // The composer still shows the attachment — only the persisted copy loses it.
  expect(useChatInputDraftStore.getState().getDraft(TARGET).images).toHaveLength(1)
})

test('concurrent prepared batches cannot overfill the attachment contract', () => {
  const drafts = useChatInputDraftStore.getState()
  expect(
    drafts.addImages(
      TARGET,
      Array.from({ length: 7 }, (_, index) => imageAttachment(`existing-${index}`)),
    ),
  ).toBe(7)
  expect(drafts.addImages(TARGET, [imageAttachment('batch-a')])).toBe(1)
  expect(drafts.addImages(TARGET, [imageAttachment('batch-b')])).toBe(0)
  expect(drafts.getDraft(TARGET).images).toHaveLength(8)
})

test('restores prompt and model selection but drops attachments on hydrate', () => {
  useChatInputDraftStore.getState().setPrompt(TARGET, 'Explain this screenshot')
  useChatInputDraftStore.getState().setModelSelection(TARGET, {
    model: 'codex-test',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  })
  useChatInputDraftStore.getState().addImages(TARGET, [imageAttachment('image-1')])

  expect(flushChatInputDraftStorage()).toBe(true)

  resetChatInputDraftStore()
  hydrateChatInputDraftStoreFromStorage(testScopedStorage)

  const draft = useChatInputDraftStore.getState().getDraft(TARGET)
  expect(draft.prompt).toBe('Explain this screenshot')
  expect(draft.modelSelection?.model).toBe('codex-test')
  expect(draft.images).toHaveLength(0)
})

test('keeps the text draft when the images would blow the storage quota', () => {
  useChatInputDraftStore.getState().setPrompt(TARGET, 'Compare these two screenshots')
  useChatInputDraftStore
    .getState()
    .addImages(TARGET, [
      imageAttachment('image-1', SCREENSHOT_BASE64_CHARS),
      imageAttachment('image-2', SCREENSHOT_BASE64_CHARS),
    ])

  expect(flushChatInputDraftStorage()).toBe(true)
  expect(useChatInputDraftStore.getState().persistenceError).toBeNull()

  resetChatInputDraftStore()
  hydrateChatInputDraftStoreFromStorage(testScopedStorage)

  expect(useChatInputDraftStore.getState().getDraft(TARGET).prompt).toBe(
    'Compare these two screenshots',
  )
})

test('drops stored image records that carry no preview source', () => {
  const draftId =
    chatInputDraftStorageId(FIXTURE_ENVIRONMENT_ID, TARGET.rootPath, TARGET.draftKey) ?? ''
  testScopedStorage.setItem(
    CHAT_INPUT_DRAFT_STORAGE_KEY,
    JSON.stringify({
      draftsByKey: {
        [draftId]: {
          images: [
            {
              id: 'image-1',
              mimeType: 'image/png',
              name: 'screenshot.png',
              sizeBytes: 3,
              type: 'image',
            },
          ],
          prompt: 'Ship it',
        },
      },
      version: 2,
    }),
  )

  hydrateChatInputDraftStoreFromStorage(testScopedStorage)

  const draft = useChatInputDraftStore.getState().getDraft(TARGET)
  expect(draft.prompt).toBe('Ship it')
  expect(draft.images).toHaveLength(0)
})

test('clears a draft after successful send cleanup', () => {
  useChatInputDraftStore.getState().setPrompt(TARGET, 'Ship it')
  useChatInputDraftStore.getState().addImages(TARGET, [imageAttachment('image-1')])
  useChatInputDraftStore.getState().clearDraft(TARGET)

  expect(flushChatInputDraftStorage()).toBe(true)
  expect(useChatInputDraftStore.getState().getDraft(TARGET).prompt).toBe('')
  expect(testScopedStorage.getItem(CHAT_INPUT_DRAFT_STORAGE_KEY)).toContain('"draftsByKey":{}')
})

test('keeps in-memory attachments when local storage persistence fails', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: throwingLocalStorage(),
  })
  resetChatInputDraftStore()
  useChatInputDraftStore.getState().addImages(TARGET, [imageAttachment('image-1')])

  expect(flushChatInputDraftStorage()).toBe(false)
  expect(useChatInputDraftStore.getState().persistenceError).toBe(
    'Chat draft could not be saved locally.',
  )
  expect(useChatInputDraftStore.getState().getDraft(TARGET).images).toHaveLength(1)
})

test('captured terminal output survives a reload, unlike image bytes', () => {
  const store = useChatInputDraftStore.getState()
  store.addTerminalContexts(TARGET, [terminalContext('context-1')])
  store.addImages(TARGET, [imageAttachment('image-1')])

  expect(flushChatInputDraftStorage()).toBe(true)
  hydrateChatInputDraftStoreFromStorage(testScopedStorage)

  const restored = useChatInputDraftStore.getState().getDraft(TARGET)
  expect(restored.terminalContexts).toEqual([terminalContext('context-1')])
  expect(restored.images).toHaveLength(0)
})

test('the same capture delivered twice only lands once', () => {
  const store = useChatInputDraftStore.getState()
  store.addTerminalContexts(TARGET, [terminalContext('context-1')])
  store.addTerminalContexts(TARGET, [terminalContext('context-1'), terminalContext('context-2')])

  expect(
    useChatInputDraftStore
      .getState()
      .getDraft(TARGET)
      .terminalContexts.map((context) => context.id),
  ).toEqual(['context-1', 'context-2'])
})

test('dropping the last capture leaves no draft behind', () => {
  const store = useChatInputDraftStore.getState()
  store.addTerminalContexts(TARGET, [terminalContext('context-1')])
  store.removeTerminalContext(TARGET, 'context-1')

  expect(useChatInputDraftStore.getState().getDraft(TARGET).terminalContexts).toHaveLength(0)
  expect(
    useChatInputDraftStore.getState().draftsByKey[
      chatInputDraftStorageId(FIXTURE_ENVIRONMENT_ID, TARGET.rootPath, TARGET.draftKey) ?? ''
    ],
  ).toBeUndefined()
})

function terminalContext(id: string) {
  return { id, lineEnd: 812, lineStart: 810, source: 'terminal-1', text: 'Error 1' }
}

function imageAttachment(id: string, base64Chars = 8): ChatInputImageAttachment {
  const dataUrl = `data:image/png;base64,${'A'.repeat(base64Chars)}`

  return {
    dataUrl,
    id,
    mimeType: 'image/png',
    name: `${id}.png`,
    previewUrl: dataUrl,
    sizeBytes: base64Chars,
    type: 'image',
  }
}

function quotaLimitedLocalStorage() {
  return {
    getItem: (key: string) => STORE.get(key) ?? null,
    removeItem: (key: string) => {
      STORE.delete(key)
    },
    setItem: (key: string, value: string) => {
      if (value.length > LOCAL_STORAGE_QUOTA_CHARS) throw quotaExceeded()

      STORE.set(key, value)
    },
  }
}

function throwingLocalStorage() {
  return {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw quotaExceeded()
    },
  }
}

// What a browser actually throws once the origin's storage is full.
function quotaExceeded() {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError')
}
