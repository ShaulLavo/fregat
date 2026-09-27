import { afterEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { Toaster } from '@workspace/ui/components/sonner'
import * as v from 'valibot'
import { environmentIdSchema, sessionIdSchema, commandIdSchema } from '@workspace/contracts'
import {
  forgetSessionUndo,
  offerSessionUndo,
  resetSessionUndo,
  sessionUndoAvailable,
} from '@/features/chat-mode/state/session-undo'
import { useSessionUndoStore } from '@/features/chat-mode/state/session-undo-history'
import { renderWithProviders } from '../../../../../test/render'
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

test('each action gets its own notice, and its Undo ends when that notice closes', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  renderWithProviders(<Toaster />)
  act(() => {
    offerSessionUndo({ kind: 'settle', entries: [entry('a')], detail: '', shortcut: null })
    offerSessionUndo({ kind: 'archive', entries: [entry('b')], detail: '', shortcut: null })
  })
  // Sonner adds toasts on a timer.
  act(() => vi.advanceTimersByTime(0))
  const archived = screen.getByText('1 archived').closest('[data-sonner-toast]')!
  expect(screen.getByText('1 settled')).toBeTruthy()
  const kinds = () => useSessionUndoStore.getState().undo.map((batch) => batch.kind)
  expect(kinds()).toEqual(['settle', 'archive'])
  fireEvent.click(within(archived as HTMLElement).getByRole('button', { name: 'Close toast' }))
  expect(kinds()).toEqual(['settle'])
  act(() => vi.advanceTimersByTime(5_000))
  expect(sessionUndoAvailable()).toBe(false)
})

test('forgetting every row of an action drops that action from the history', () => {
  offerSessionUndo({ kind: 'settle', entries: [entry('a')], detail: '', shortcut: null })
  offerSessionUndo({ kind: 'archive', entries: [entry('b')], detail: '', shortcut: null })
  forgetSessionUndo([entry('b').ref])
  expect(useSessionUndoStore.getState().undo.map((batch) => batch.kind)).toEqual(['settle'])
})

test('forgetting one row of a bulk action lowers the count its notice shows', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  renderWithProviders(<Toaster />)
  act(() => {
    offerSessionUndo({
      kind: 'archive',
      entries: [entry('a'), entry('b')],
      detail: '',
      shortcut: null,
    })
  })
  act(() => vi.advanceTimersByTime(0))
  expect(screen.getByText('2 archived')).toBeTruthy()
  act(() => forgetSessionUndo([entry('a').ref]))
  expect(screen.getByText('1 archived')).toBeTruthy()
})
