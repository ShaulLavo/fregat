import * as v from 'valibot'
import { beforeEach } from 'vitest'
import { messageIdSchema, proposedPlanIdSchema, turnIdSchema } from '@workspace/contracts'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import {
  syncChatProjectionShellSnapshot,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'
import {
  chatProjectionCacheFromState,
  hydrateChatProjectionState,
  writeChatProjectionCache,
  readChatProjectionCache,
} from '@/features/chat/state/chat-projection-cache'
import { clearTimelineReload } from '@/features/chat/state/timeline-reload'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import { expect, test } from '../../../../../test/fixtures'
import {
  TEST_ENVIRONMENT_ID,
  fixtureSessionId,
  sessionShell,
  shellSnapshot,
  chatMessage,
  turnDiffSummary,
} from '../../../../../test/factories/chat'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'

beforeEach(() => {
  clearTimelineReload(TEST_ENVIRONMENT_ID)
})

test('the visible older session and message window outrank recent tails while summaries remain observations', () => {
  const sessions = Array.from({ length: 5 }, (_, index) =>
    sessionShell({
      id: fixtureSessionId(index + 1),
      updatedAt: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
    }),
  )
  const visible = sessions[0]!
  writeWorkspaceCacheEntry(
    'chat.timeline-view.v1',
    {
      sessionId: visible.id,
      anchorId: 'message:m15',
      anchorOffset: 12,
      followEnd: false,
      width: 900,
      height: 600,
      typography: '',
      rows: [{ id: 'proposed-plan:plan-visible', generation: null, size: 100 }],
      messageIds: ['m10', 'm15', 'm20'],
    },
    { storage: environmentWindowStorage(TEST_ENVIRONMENT_ID) },
  )
  let slice = syncChatProjectionShellSnapshot(
    createInitialChatProjectionSlice(),
    shellSnapshot({ sessions }),
  )
  const checkpoint = turnDiffSummary({
    sessionId: visible.id,
    assistantMessageId: v.parse(messageIdSchema, 'm15'),
  })
  const plan = {
    id: v.parse(proposedPlanIdSchema, 'plan-visible'),
    sessionId: visible.id,
    turnId: null,
    planMarkdown: '# Observed plan',
    createdAt: visible.createdAt,
    updatedAt: visible.updatedAt,
  }
  for (const shell of sessions) {
    slice = syncChatProjectionSessionDetailSnapshot(slice, {
      snapshotSequence: 10,
      session: {
        ...shell,
        activities: [],
        messages: Array.from({ length: 100 }, (_, index) =>
          chatMessage({ id: v.parse(messageIdSchema, `m${index}`), sessionId: shell.id }),
        ),
        deletedAt: null,
        deletion: null,
      },
      proposedPlans:
        shell.id === visible.id
          ? [
              plan,
              ...Array.from({ length: 60 }, (_, index) => ({
                ...plan,
                id: v.parse(proposedPlanIdSchema, `new-plan-${index}`),
              })),
            ]
          : [],
      checkpoints:
        shell.id === visible.id
          ? [
              checkpoint,
              ...Array.from({ length: 60 }, (_, index) => ({
                ...checkpoint,
                assistantMessageId: v.parse(messageIdSchema, 'm99'),
                turnId: v.parse(turnIdSchema, `new-turn-${index}`),
                checkpointTurnCount: index + 2,
              })),
            ]
          : [],
    })
  }
  const cached = chatProjectionCacheFromState({ slices: { [TEST_ENVIRONMENT_ID]: slice } })
  const transcript = cached.slices[0]!.transcripts[0]!
  expect(transcript.sessionId).toBe(visible.id)
  expect(transcript.messages.some((message) => message.id === 'm15')).toBe(true)
  expect(transcript.messages.some((message) => message.id === 'm99')).toBe(false)
  expect(transcript.hasEarlier).toBe(true)
  expect(transcript.proposedPlans).toHaveLength(40)
  expect(transcript.proposedPlans).toContainEqual(plan)
  expect(transcript.checkpoints).toHaveLength(40)
  expect(transcript.checkpoints).toContainEqual(checkpoint)
  const restored = hydrateChatProjectionState({ slices: {} }, cached).slices[TEST_ENVIRONMENT_ID]!
  expect(restored.sessionDetailSequenceById).toEqual({})
  expect(restored.sessionHistorySequenceById).toEqual({})
  expect(restored.bootstrapComplete).toBe(false)
  expect(restored.proposedPlanIdsBySessionId[visible.id]).toContain(plan.id)
})

test('an oversized transcript falls back to shell coverage, never a confirmed empty transcript', () => {
  const shell = sessionShell()
  let slice = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shellSnapshot())
  slice = syncChatProjectionSessionDetailSnapshot(slice, {
    snapshotSequence: 1,
    checkpoints: [],
    proposedPlans: [],
    session: {
      ...shell,
      activities: [],
      messages: [chatMessage({ text: 'x'.repeat(600_000) })],
      deletedAt: null,
      deletion: null,
    },
  })
  const cached = chatProjectionCacheFromState({ slices: { [TEST_ENVIRONMENT_ID]: slice } })
  expect(writeChatProjectionCache(testScopedStorage, cached)).toBe(true)
  const read = readChatProjectionCache(testScopedStorage)
  expect(read?.slices[0]?.transcripts).toEqual([])
  const restored = hydrateChatProjectionState({ slices: {} }, read).slices[TEST_ENVIRONMENT_ID]!
  expect(restored.sessionById[shell.id]?.detailSynced).toBe(false)
})
