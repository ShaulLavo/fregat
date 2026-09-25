import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { renderHook } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { beforeEach } from 'vitest'
import type { RefObject } from 'react'

import { useComposerInbox } from '@/features/chat/hooks/use-composer-inbox'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import {
  resetComposerInboxStore,
  useComposerInboxStore,
} from '@/features/chat/state/composer-inbox-store'
import { expect, test } from '../../../../../test/fixtures'

const TARGET: ChatInputDraftTarget = {
  environmentId: FIXTURE_ENVIRONMENT_ID,
  draftKey: 'ad686244-5b2e-59be-805f-ef86eac80feb',
  rootPath: '/repo',
}
const HERE = { environmentId: TARGET.environmentId, rootPath: TARGET.rootPath }
const FAILURE = {
  lineEnd: 812,
  lineStart: 810,
  source: 'terminal-1',
  text: 'make: *** [build] Error 1',
}

beforeEach(() => {
  resetComposerInboxStore()
  resetChatInputDraftStore()
})

/** No editor yet is the real first-render state, not a contrived one. */
function noEditor(): RefObject<LexicalEditor | null> {
  return { current: null }
}

test('a capture queued before the composer mounts still lands on its draft', () => {
  useComposerInboxStore.getState().queueTerminalContext(FAILURE, HERE)

  renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  const draft = useChatInputDraftStore.getState().getDraft(TARGET)
  expect(draft.terminalContexts.map((context) => context.text)).toEqual([FAILURE.text])
  expect(useComposerInboxStore.getState().pending).toHaveLength(0)
})

test('a capture queued while the composer is open is drained too', () => {
  const { rerender } = renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  useComposerInboxStore.getState().queueTerminalContext(FAILURE, HERE)
  rerender()

  expect(useChatInputDraftStore.getState().getDraft(TARGET).terminalContexts).toHaveLength(1)
})

test('text stays queued until there is a caret to splice it into', () => {
  useComposerInboxStore.getState().queueText('why did this fail?', HERE)

  renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  // The editor mounts a render later than the component. Taking the text here
  // would silently discard something the user explicitly asked to send.
  expect(useComposerInboxStore.getState().pending).toEqual([
    { destination: HERE, kind: 'text', text: 'why did this fail?' },
  ])
})

test('a mixed batch keeps the chip even when the text has to wait', () => {
  const store = useComposerInboxStore.getState()
  store.queueText('look at this', HERE)
  store.queueTerminalContext(FAILURE, HERE)

  renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  expect(useChatInputDraftStore.getState().getDraft(TARGET).terminalContexts).toHaveLength(1)
  expect(useComposerInboxStore.getState().pending.map((entry) => entry.kind)).toEqual(['text'])
})

test("another workspace's capture stays queued for its own composer", () => {
  const elsewhere = { ...HERE, rootPath: '/other' }
  useComposerInboxStore.getState().queueTerminalContext(FAILURE, elsewhere)

  const { rerender } = renderHook(({ target }) => useComposerInbox(target, noEditor(), false), {
    initialProps: { target: TARGET },
  })

  expect(useChatInputDraftStore.getState().getDraft(TARGET).terminalContexts).toHaveLength(0)
  expect(useComposerInboxStore.getState().pending).toHaveLength(1)

  const there = { ...TARGET, rootPath: '/other' }
  rerender({ target: there })

  expect(useChatInputDraftStore.getState().getDraft(there).terminalContexts).toHaveLength(1)
  expect(useComposerInboxStore.getState().pending).toHaveLength(0)
})

test('an empty inbox never touches the draft', () => {
  renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  expect(useChatInputDraftStore.getState().getDraft(TARGET).terminalContexts).toHaveLength(0)
})

test('an append waits for a caret like text does', () => {
  useComposerInboxStore.getState().queueAppend('Create a document using this $skill about…', HERE)

  renderHook(() => useComposerInbox(TARGET, noEditor(), false))

  expect(useComposerInboxStore.getState().pending.map((entry) => entry.kind)).toEqual(['append'])
})

test('append from a different workspace stays queued even after an editor is ready', () => {
  const elsewhere = { ...HERE, rootPath: '/other' }
  useComposerInboxStore.getState().queueAppend('Use template', elsewhere)
  renderHook(() => useComposerInbox(TARGET, noEditor(), true))
  expect(useComposerInboxStore.getState().pending).toEqual([
    { kind: 'append', text: 'Use template', destination: elsewhere },
  ])
})
