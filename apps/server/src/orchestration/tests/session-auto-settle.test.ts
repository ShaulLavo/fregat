import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import * as v from 'valibot'
import {
  orchestrationCommandSchema,
  type GitPullRequest,
  type WorktreePullRequest,
} from '@workspace/contracts'
import { closeTestApps } from '../../../test/server'
import {
  lifecycleSessionId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import type { BranchPullRequestLookup } from '../pull-request-sync-reactor'
import type { OrchestrationProjectedSession } from '../read-model'
import { autoSettlementAt } from '../utils/auto-settlement'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

const DAY = 24 * 60 * 60 * 1_000

const internal = (command: Record<string, unknown>) => v.parse(orchestrationCommandSchema, command)

function forge(state: GitPullRequest['state'], closedAt: string | null): BranchPullRequestLookup {
  return async ({ branches }) => ({
    kind: 'ready',
    pullRequests: new Map(
      branches.map((branch) => [
        branch,
        {
          number: 3,
          title: 'Change',
          url: 'https://github.com/acme/repo/pull/3',
          state,
          draft: false,
          closedAt,
        },
      ]),
    ),
  })
}

async function settledSession(fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>) {
  await fixture.engine.syncPullRequests()
  await fixture.engine.settleSessions()
  return (await fixture.engine.readModelSnapshot()).sessions.get(lifecycleSessionId)
}

describe('automatic settlement through the engine', () => {
  test('a merge after the last request settles the session at its last activity', async () => {
    const fixture = await worktreeLifecycleFixture({
      pullRequestLookup: forge('merged', new Date(Date.now() + 60_000).toISOString()),
    })
    fixtures.push(fixture)
    await fixture.create()
    const session = await settledSession(fixture)
    expect(session?.settledOverride).toBe('settled')
    expect(session?.settledAt).toBe(session?.latestTurn?.completedAt)
  })

  test('a merge before the last request, or with merge settlement off, leaves it active', async () => {
    const stale = await worktreeLifecycleFixture({
      pullRequestLookup: forge('merged', new Date(Date.now() - DAY).toISOString()),
    })
    fixtures.push(stale)
    await stale.create()
    expect((await settledSession(stale))?.settledOverride ?? null).toBeNull()

    const off = await worktreeLifecycleFixture({
      pullRequestLookup: forge('merged', new Date(Date.now() + 60_000).toISOString()),
    })
    fixtures.push(off)
    await writeFile(
      path.join(off.root, '.git', 'settings.json'),
      JSON.stringify({ 'chat.autoSettleOnMerge': false }),
    )
    await off.restart()
    await off.create()
    expect((await settledSession(off))?.settledOverride ?? null).toBeNull()
  })

  test('a decision read before a later session event is refused', async () => {
    const fixture = await worktreeLifecycleFixture()
    fixtures.push(fixture)
    await fixture.create()
    const before = (await fixture.engine.readModelSnapshot()).sequence
    await fixture.command({
      type: 'session.meta.update',
      sessionId: lifecycleSessionId,
      title: 'Renamed',
    })
    await expect(
      fixture.engine.dispatch(
        internal({
          type: 'session.auto-settle',
          commandId: 'auto-settle-stale',
          sessionId: lifecycleSessionId,
          settledAt: new Date().toISOString(),
          snapshotSequence: before,
        }),
      ),
    ).rejects.toMatchObject({ code: expect.stringContaining('AUTO_SETTLE_STALE') })
    const current = (await fixture.engine.readModelSnapshot()).sequence
    await fixture.engine.dispatch(
      internal({
        type: 'session.auto-settle',
        commandId: 'auto-settle-current',
        sessionId: lifecycleSessionId,
        settledAt: '2026-01-01T00:00:00.000Z',
        snapshotSequence: current,
      }),
    )
    const session = (await fixture.engine.readModelSnapshot()).sessions.get(lifecycleSessionId)
    expect(session).toMatchObject({
      settledOverride: 'settled',
      settledAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('automatic settlement policy', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z')
  const rules = { afterDays: 3, onMerge: true }
  const base = {
    id: lifecycleSessionId,
    createdAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    activities: [],
    runtime: null,
    latestUserMessageAt: '2026-09-20T10:00:00.000Z',
    latestTurn: {
      state: 'completed',
      requestedAt: '2026-09-20T10:00:00.000Z',
      startedAt: '2026-09-20T10:00:01.000Z',
      completedAt: '2026-09-20T10:05:00.000Z',
      providerStartState: 'settled',
    },
  } as unknown as OrchestrationProjectedSession
  const at = (
    session: Partial<OrchestrationProjectedSession>,
    pullRequest: WorktreePullRequest | null = null,
    overrides: Partial<{ backgroundLive: boolean; afterDays: number }> = {},
  ) =>
    autoSettlementAt({
      session: { ...base, ...session } as OrchestrationProjectedSession,
      pullRequest,
      backgroundLive: overrides.backgroundLive ?? false,
      now,
      rules: { ...rules, afterDays: overrides.afterDays ?? rules.afterDays },
    })

  test('inactivity settles at the last activity, and only past the configured days', () => {
    expect(at({})).toBe('2026-09-20T10:05:00.000Z')
    expect(at({ latestUserMessageAt: '2026-09-24T00:00:00.000Z' })).toBeNull()
    expect(at({}, null, { afterDays: 0 })).toBeNull()
  })

  test('keep-active, snooze, background work and pending requests block it', () => {
    expect(at({ settledOverride: 'active' })).toBeNull()
    expect(
      at({ snoozedUntil: '2026-10-01T00:00:00.000Z', snoozedAt: '2026-09-21T00:00:00.000Z' }),
    ).toBeNull()
    expect(at({}, null, { backgroundLive: true })).toBeNull()
    expect(at({ pendingApprovalCount: 1 })).toBeNull()
  })

  test('an open or unanswered pull request blocks it; a later close settles it', () => {
    const found = {
      status: 'found',
      number: 1,
      title: 't',
      url: 'https://x/1',
      draft: false,
    } as const
    expect(at({}, { ...found, state: 'open', closedAt: null })).toBeNull()
    expect(at({}, { status: 'unknown' })).toBeNull()
    expect(
      at(
        { latestUserMessageAt: '2026-09-25T11:00:00.000Z', latestTurn: undefined },
        { ...found, state: 'closed', closedAt: '2026-09-25T11:30:00.000Z' },
        { afterDays: 0 },
      ),
    ).toBe('2026-09-25T11:00:00.000Z')
  })
})
