import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  providerDriverKindSchema,
  sessionIdSchema,
  type SessionId,
} from '@workspace/contracts'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { OrchestrationProjectionPipeline } from '../../orchestration/projection-pipeline'
import {
  DOMAIN_AT,
  DOMAIN_IDS,
  DOMAIN_MODEL,
  domainBootstrap,
  domainEvent,
} from '../../orchestration/tests/factories/session-domain'
import { ProviderSessionDirectory } from '../provider-session-directory'
import { ProviderSessionReaper } from '../provider-session-reaper'

const DEADLINE_MS = 30 * 60 * 1000
const START_MS = Date.parse('2026-06-01T12:00:00.000Z')

describe('ProviderSessionReaper', () => {
  it('preserves quiet background work and reclaims it only after completion', async () => {
    let background = true
    const fixture = createFixture({ hasBackgroundWork: () => background })
    try {
      fixture.bind('93ff7ec0-5902-5ddf-b36e-b6b705a8bc41', 'ready')
      fixture.advanceTo(START_MS + DEADLINE_MS * 3)
      expect(await fixture.reaper.sweep()).toEqual([])
      background = false
      expect(await fixture.reaper.sweep()).toEqual(['93ff7ec0-5902-5ddf-b36e-b6b705a8bc41'])
    } finally {
      fixture.close()
    }
  })

  it('joins overlapping sweeps and rechecks later candidates after awaiting a stop', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let background = false
    const protectedId = '9b1e820c-d996-548c-8a05-cef70f5bec06'
    const fixture = createFixture({
      hasBackgroundWork: (id) => id === protectedId && background,
      stopRuntime: async () => {
        entered.resolve()
        await release.promise
      },
    })
    try {
      fixture.bind('7e156e14-152f-57e3-a391-567aac7ae6ab', 'ready')
      fixture.bind(protectedId, 'ready')
      fixture.advanceTo(START_MS + DEADLINE_MS * 3)
      const first = fixture.reaper.sweep()
      await entered.promise
      const second = fixture.reaper.sweep()
      expect(second).toBe(first)
      background = true
      release.resolve()
      expect(await first).toEqual(['7e156e14-152f-57e3-a391-567aac7ae6ab'])
    } finally {
      release.resolve()
      await fixture.reaper.waitForIdle()
      fixture.close()
    }
  })

  it('reclaims a session nobody has touched past the deadline', async () => {
    const fixture = createFixture()
    try {
      fixture.bind('93ff7ec0-5902-5ddf-b36e-b6b705a8bc41', 'ready')
      fixture.advanceTo(START_MS + DEADLINE_MS + 1)

      expect(await fixture.reaper.sweep()).toEqual(['93ff7ec0-5902-5ddf-b36e-b6b705a8bc41'])
      expect(fixture.stopped).toEqual(['93ff7ec0-5902-5ddf-b36e-b6b705a8bc41'])
    } finally {
      fixture.close()
    }
  })

  it('leaves a long turn alone because its event stream keeps stamping liveness', async () => {
    const fixture = createFixture()
    try {
      // Streaming updates liveness without changing the projected runtime status.
      fixture.bind('7e156e14-152f-57e3-a391-567aac7ae6ab', 'ready')
      fixture.bind('3b1e820c-d996-548c-8a05-cef70f5bec06', 'ready')
      for (let elapsed = 0; elapsed <= DEADLINE_MS * 2; elapsed += 60_000) {
        fixture.advanceTo(START_MS + elapsed)
        fixture.directory.markSeen(sessionId('7e156e14-152f-57e3-a391-567aac7ae6ab'))
      }

      expect(await fixture.reaper.sweep()).toEqual(['3b1e820c-d996-548c-8a05-cef70f5bec06'])
    } finally {
      fixture.close()
    }
  })

  it('never reclaims a session that is mid-work, however long it has been quiet', async () => {
    const fixture = createFixture()
    try {
      // `waiting` is compaction or an unanswered approval: state that dies with
      // the process. `running` is the agent talking. Neither is reclaimable at
      // any age, so both outlive a deadline they are well past.
      fixture.bind('8cfebe2a-5772-5610-915d-e7abef81a4da', 'running')
      fixture.bind('83ecfd03-818e-5c87-b43b-8151d9994750', 'waiting')
      fixture.bind('aefacffd-ea8b-51c7-a1fa-1c7ff3b7c5b2', 'starting')
      fixture.advanceTo(START_MS + DEADLINE_MS * 10)

      expect(await fixture.reaper.sweep()).toEqual([])
      expect(fixture.stopped).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('spares the session being ensured, which is often the oldest one there is', async () => {
    const fixture = createFixture()
    try {
      fixture.bind('3c88bcb9-25f1-5278-8eeb-2bc6be92c2e3', 'ready')
      fixture.advanceTo(START_MS + DEADLINE_MS + 1)

      const reaped = await fixture.reaper.sweep({
        exceptSessionId: sessionId('3c88bcb9-25f1-5278-8eeb-2bc6be92c2e3'),
      })

      expect(reaped).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('keeps sweeping after an adapter refuses to stop', async () => {
    const fixture = createFixture({
      stopRuntime: async ({ sessionId: id }) => {
        if (id === '7e65cec6-897b-58f2-b706-455167c6c1a0') throw new Error('adapter is wedged')
      },
    })
    try {
      fixture.bind('7e65cec6-897b-58f2-b706-455167c6c1a0', 'ready')
      fixture.bind('14935d5c-7233-5fb5-b01c-b6c94e2b7b73', 'ready')
      fixture.advanceTo(START_MS + DEADLINE_MS + 1)

      // Housekeeping runs alongside a turn the user asked for. One wedged
      // adapter must not take the sweep — or that turn — down with it.
      expect(await fixture.reaper.sweep()).toEqual(['14935d5c-7233-5fb5-b01c-b6c94e2b7b73'])
    } finally {
      fixture.close()
    }
  })
})

function sessionId(id: string) {
  return v.parse(sessionIdSchema, id)
}

function createFixture(
  options: {
    stopRuntime?: (input: { sessionId: SessionId }) => Promise<unknown>
    hasBackgroundWork?: (sessionId: SessionId) => boolean
  } = {},
) {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  const pipeline = new OrchestrationProjectionPipeline(database)
  pipeline.applyEvents(domainBootstrap())
  let sequence = 3
  let nowMs = START_MS
  const now = () => nowMs
  const stopped: string[] = []
  const directory = new ProviderSessionDirectory(database, { now })
  const reaper = new ProviderSessionReaper({
    deadlineMs: DEADLINE_MS,
    hasBackgroundWork: options.hasBackgroundWork,
    directory,
    now,
    stopRuntime: async (input) => {
      await options.stopRuntime?.(input)
      stopped.push(input.sessionId)
    },
  })

  return {
    advanceTo: (at: number) => {
      nowMs = at
    },
    bind: (id: string, status: 'ready' | 'running' | 'starting' | 'waiting') => {
      pipeline.applyEvents([
        domainEvent(
          'session.created',
          {
            sessionId: id,
            worktreeId: DOMAIN_IDS.worktree,
            origin: 'platform',
            title: 'Session',
            modelSelection: DOMAIN_MODEL,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: 'default',
            createdAt: DOMAIN_AT,
            updatedAt: DOMAIN_AT,
          },
          ++sequence,
        ),
        domainEvent(
          'session.runtime-set',
          {
            sessionId: id,
            runtime: {
              sessionId: id,
              status,
              providerName: 'codex',
              providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              runtimeEpoch: 'epoch-test',
              providerBindingHandle: null,
              providerConversationMarker: null,
              providerResumeCursor: null,
              activeTurnId: null,
              lastError: null,
              updatedAt: DOMAIN_AT,
            },
            updatedAt: DOMAIN_AT,
          },
          ++sequence,
        ),
      ])
      directory.upsert({
        providerDriverKind: v.parse(providerDriverKindSchema, 'codex'),
        providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        runtimeEpoch: 'epoch-test',
        sessionId: sessionId(id),
      })
    },
    close: () => sqlite.close(),
    directory,
    reaper,
    stopped,
  }
}
