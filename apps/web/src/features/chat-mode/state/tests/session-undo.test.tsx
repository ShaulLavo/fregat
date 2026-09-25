import { afterEach, vi } from 'vitest'
import * as v from 'valibot'
import { environmentIdSchema, sessionIdSchema, commandIdSchema } from '@workspace/contracts'
import {
  forgetSessionUndo,
  offerSessionUndo,
  resetSessionUndo,
  sessionUndoAvailable,
  useSessionUndoStore,
} from '@/features/chat-mode/state/session-undo'
import { expect, test } from '../../../../../test/fixtures'

afterEach(() => {
  resetSessionUndo()
  vi.useRealTimers()
})
function entry(id: string) {
  return {
    ref: {
      environmentId: v.parse(environmentIdSchema, '11111111-1111-4111-8111-111111111111'),
      sessionId: v.parse(
        sessionIdSchema,
        `00000000-0000-4000-8000-${Array.from(id)
          .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
          .toString(16)
          .padStart(12, '0')}`,
      ),
    },
    restoreCommandId: v.parse(commandIdSchema, `command-${id}`),
    expectedRevision: 1,
    restoreRevision: 0,
    reopen: null,
    before: {
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      unsettledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      acknowledgedFailureThroughSequence: null,
    },
  }
}

test('history outlives the notice and keeps consecutive actions separate', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  offerSessionUndo({ kind: 'settle', entries: [entry('a')], detail: '', shortcut: null })
  offerSessionUndo({ kind: 'archive', entries: [entry('b')], detail: '', shortcut: null })
  vi.advanceTimersByTime(60_000)
  expect(sessionUndoAvailable()).toBe(true)
  expect(useSessionUndoStore.getState().undo.map((batch) => batch.kind)).toEqual([
    'settle',
    'archive',
  ])
  forgetSessionUndo([entry('b').ref])
  expect(useSessionUndoStore.getState().undo).toHaveLength(1)
})
