import * as v from 'valibot'
import {
  environmentIdSchema,
  orchestrationSessionShellSchema,
  type OrchestrationSessionShell,
  type OrchestrationShellStreamFrame,
} from '@workspace/contracts'
import { expect, it } from 'vitest'
import { createSessionNoticeFeed } from '../session-notice-feed'

const environmentId = v.parse(environmentIdSchema, '10000000-0000-4000-8000-000000000001')
const session = v.parse(orchestrationSessionShellSchema, {
  id: '00000000-0000-4000-8000-000000000001',
  worktreeId: '00000000-0000-4000-8000-000000000002',
  origin: 'platform',
  attentionState: 'settled',
  attentionReason: null,
  acknowledgedFailureThroughSequence: null,
  hasError: false,
  title: 'Fixture',
  modelSelection: { providerInstanceId: 'codex', model: 'mock-model' },
  runtimeMode: 'full-access',
  interactionMode: 'default',
  latestTurn: null,
  createdAt: '2026-09-25T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  archivedAt: null,
  runtime: null,
  latestUserMessageAt: null,
  pendingApprovalCount: 0,
  pendingUserInputCount: 0,
  hasActionableProposedPlan: false,
})

const input = { ...session, pendingUserInputCount: 1 }
const completed: OrchestrationSessionShell = {
  ...session,
  latestTurn: {
    ...turn(),
    state: 'completed',
    completedAt: '2026-09-25T10:05:00.000Z',
  },
}

it('keeps the snapshot and catch-up silent, then announces each live change once', () => {
  const feed = createSessionNoticeFeed(environmentId)

  expect(feed.accept(snapshot([session]))).toBeNull()
  expect(feed.accept(upserted(input))).toBeNull()
  expect(feed.accept(upserted(session))).toBeNull()
  expect(feed.accept({ kind: 'synchronized', sequence: 3 })).toBeNull()

  expect(feed.accept(upserted(input))).toMatchObject({
    notice: {
      ref: { environmentId, sessionId: session.id },
      kind: 'input',
      title: 'Input needed',
      body: 'Fixture',
    },
    worktreeId: session.worktreeId,
  })
  expect(feed.accept(upserted(input))).toBeNull()
  expect(feed.accept(upserted(completed))).toMatchObject({
    notice: { kind: 'completion', title: 'Session completed' },
  })
  expect(feed.accept(upserted(completed))).toBeNull()
})

it('stays silent for an archived session and for one it has not seen before', () => {
  const feed = createSessionNoticeFeed(environmentId)
  feed.accept(snapshot([session]))
  feed.accept({ kind: 'synchronized', sequence: 1 })

  expect(feed.accept(upserted({ ...completed, archivedAt: '2026-09-25T10:06:00.000Z' }))).toBeNull()
  expect(feed.accept({ kind: 'session-removed', sessionId: session.id, sequence: 3 })).toBeNull()
  expect(feed.accept(upserted(input))).toBeNull()
  expect(feed.accept(upserted(session))).toBeNull()
  expect(feed.accept(upserted(input))).toMatchObject({ notice: { kind: 'input' } })
})

function turn() {
  return v.parse(orchestrationSessionShellSchema, {
    ...session,
    latestTurn: {
      turnId: 'turn-1',
      state: 'running',
      requestedAt: '2026-09-25T10:01:00.000Z',
      startedAt: '2026-09-25T10:01:00.000Z',
      completedAt: null,
      assistantMessageId: null,
      providerStartState: 'settled',
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: null,
    },
  }).latestTurn!
}

let sequence = 1

function snapshot(sessions: readonly OrchestrationSessionShell[]): OrchestrationShellStreamFrame {
  return {
    kind: 'snapshot',
    snapshot: {
      snapshotSequence: 1,
      projects: [],
      worktrees: [],
      sessions: [...sessions],
      updatedAt: '2026-09-25T10:00:00.000Z',
    },
  }
}

function upserted(next: OrchestrationSessionShell): OrchestrationShellStreamFrame {
  return { kind: 'session-upserted', sequence: ++sequence, session: next }
}
