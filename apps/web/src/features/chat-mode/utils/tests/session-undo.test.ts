import type { SessionId } from '@workspace/contracts'
import {
  dropUndoKind,
  surfaceShowsSession,
  viewedSessionSurface,
} from '@/features/chat-mode/utils/session-undo'
import { expect, test } from '../../../../../test/fixtures'

const move = { kind: 'move-active', order: [], assignments: [], unsettle: false, unsnooze: false }
const session = 'f0000000-0000-4000-8000-000000000001' as SessionId

test('a drop offers settle on Settled and unpin only when the move unpins', () => {
  expect(dropUndoKind({ kind: 'settle' })).toBe('settle')
  expect(dropUndoKind({ ...move, kind: 'move-active', unpin: true })).toBe('unpin')
  expect(dropUndoKind({ ...move, kind: 'move-active', unpin: false })).toBeNull()
  expect(dropUndoKind({ kind: 'none' })).toBeNull()
})

test('the viewed surface is the main document first, then the side chat', () => {
  const token = `t/${session}`
  expect(viewedSessionSurface({ document: token, chat: token }, session)).toBe('main')
  expect(viewedSessionSurface({ document: 't/other', chat: token }, session)).toBe('sidebar')
  expect(viewedSessionSurface({ document: null, chat: null }, session)).toBeNull()
  expect(surfaceShowsSession({ document: token, chat: null }, 'sidebar', session)).toBe(false)
})
