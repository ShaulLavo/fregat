import { afterEach, vi } from 'vitest'
import type { EnvironmentId, SessionId } from '@workspace/contracts'
import { captureSessionLifecycle } from '@workspace/client-core/chat/rail/lifecycle-undo'
import {
  forgetSessionUndo,
  offerSessionUndo,
  resetSessionUndo,
  sessionUndoAvailable,
  undoLatestSessionAction,
  useSessionUndoStore,
} from '@/features/chat-mode/state/session-undo'
import { commandWhenDisabledReason } from '@/keymap/utils/when'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { expect, test } from '../../../../../test/fixtures'

afterEach(() => {
  resetSessionUndo()
  vi.useRealTimers()
})

function entry(sessionId: string) {
  return {
    ref: { environmentId: 'env' as EnvironmentId, sessionId: sessionId as SessionId },
    before: captureSessionLifecycle({}),
    reopen: null,
  }
}

function offer(kind: 'settle' | 'archive', ...ids: string[]) {
  offerSessionUndo({ kind, entries: ids.map(entry), detail: '', shortcut: null })
}

function undoWhen() {
  return commandWhenDisabledReason(
    ['sessionActionUndoable'],
    {
      activeDocument: null,
      activeDocumentSavable: false,
      activeTabId: null,
      chatMode: true,
      sessionActionUndoable: sessionUndoAvailable(),
      workspaceOpen: true,
    },
    { kind: 'workspace' },
  )
}

test('the Undo stays available until five seconds after the latest action, then the command is disabled', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  offer('settle', 'a')
  vi.advanceTimersByTime(4_000)
  offer('settle', 'b')
  vi.advanceTimersByTime(4_999)
  expect(useSessionUndoStore.getState().slot?.entries.map((item) => item.ref.sessionId)).toEqual([
    'a',
    'b',
  ])
  expect(undoWhen()).toBeNull()
  vi.advanceTimersByTime(1)
  expect(sessionUndoAvailable()).toBe(false)
  expect(undoWhen()).toBe('No session action can be undone.')
})

test('another kind replaces the slot, and forgetting its last row ends it', () => {
  offer('settle', 'a', 'b')
  offer('archive', 'c')
  expect(useSessionUndoStore.getState().slot).toMatchObject({ kind: 'archive' })
  forgetSessionUndo([entry('c').ref])
  expect(sessionUndoAvailable()).toBe(false)
})

test('an expired or spent slot restores nothing', async () => {
  expect(await undoLatestSessionAction()).toBe(false)
  expect(
    primaryQueryClient()
      .getMutationCache()
      .findAll({ mutationKey: chatModeMutationKeys.lifecycleUndo() }),
  ).toHaveLength(0)
})
