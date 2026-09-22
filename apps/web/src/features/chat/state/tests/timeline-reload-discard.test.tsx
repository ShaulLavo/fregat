import { expect, test } from '../../../../../test/fixtures'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import {
  clearTimelineReload,
  discardTimelineReloadForSessions,
  readTimelineReload,
} from '@/features/chat/state/timeline-reload'

const KEY = 'chat.timeline-view.v1'

function seed(sessionId: string) {
  clearTimelineReload(TEST_ENVIRONMENT_ID)
  environmentWindowStorage(TEST_ENVIRONMENT_ID).setItem(
    KEY,
    JSON.stringify({
      sessionId,
      anchorId: 'item-1',
      anchorOffset: 12,
      followEnd: false,
      width: 800,
      height: 600,
      typography: 'test',
      rows: [],
      messageIds: [],
    }),
  )
}

test('a server-confirmed deletion of the remembered session retires the view', () => {
  seed(TEST_SESSION_ID)
  expect(readTimelineReload(TEST_ENVIRONMENT_ID)?.sessionId).toBe(TEST_SESSION_ID)

  discardTimelineReloadForSessions(TEST_ENVIRONMENT_ID, [
    { type: 'session.deleted', payload: { sessionId: TEST_SESSION_ID } },
  ])
  expect(readTimelineReload(TEST_ENVIRONMENT_ID)).toBeNull()
})

test('a deletion of a different session, or another event type, leaves the view alone', () => {
  seed(TEST_SESSION_ID)
  discardTimelineReloadForSessions(TEST_ENVIRONMENT_ID, [
    { type: 'session.deleted', payload: { sessionId: 'a0000000-0000-5000-8000-000000000000' } },
    { type: 'session.updated', payload: { sessionId: TEST_SESSION_ID } },
    { type: 'session.deleted' },
  ])
  expect(readTimelineReload(TEST_ENVIRONMENT_ID)?.sessionId).toBe(TEST_SESSION_ID)
  clearTimelineReload(TEST_ENVIRONMENT_ID)
})
