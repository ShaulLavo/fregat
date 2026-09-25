import { Elysia } from 'elysia'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH,
  ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH,
  type OrchestrationSearchSessionsResult,
} from '@workspace/contracts'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { OrchestrationCheckpointHunks } from '../checkpoint-hunks'
import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import { OrchestrationEngine } from '../engine'
import type { OrchestrationDatabase } from '../event-store'
import { orchestrationRoutes } from '../routes'
import { OrchestrationSessionSearchQuery } from '../session-search-query'
import {
  createProjectionFixture,
  PROJECT_ID,
  SESSION_ID,
  sessionBootstrapEvents,
} from './factories/projection'
import { searchMessageEvent, searchSessionCreatedEvent } from './factories/session-search'

const NOISE_MESSAGE_COUNT = 260
const BURIED_AT = '2026-05-24T00:01:00.000Z'
const BURIED_TEXT = 'Long ago we settled on a pelican crossing for the north intersection.'
const RECENT_SESSION_MATCH_AT = '2026-05-25T02:00:00.000Z'
const NEWEST_SESSION_MATCH_AT = '2026-05-26T00:30:00.000Z'
const LONG_MESSAGE_MATCH = 'a wombat appeared here'

let fixture: ReturnType<typeof createProjectionFixture>
let search: OrchestrationSessionSearchQuery
let app: ReturnType<typeof createSearchApp>

beforeAll(() => {
  fixture = createProjectionFixture()
  fixture.pipeline.applyEvents(fixture.append(seedEvents()))
  search = new OrchestrationSessionSearchQuery(fixture.database)
  app = createSearchApp(fixture.database, search)
})

afterAll(() => {
  fixture.close()
})

describe('orchestration session search', () => {
  it('finds a phrase in a message the session detail window no longer carries', () => {
    const detail = fixture.snapshots.sessionDetailSnapshot(SESSION_ID)
    expect(detail.session.messages).toHaveLength(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
    expect(detail.session.messages.some((message) => message.text === BURIED_TEXT)).toBe(false)

    const matches = search.search({ query: 'pelican crossing' }).matches

    expect(matches).toEqual([
      {
        messageCreatedAt: BURIED_AT,
        projectId: PROJECT_ID,
        worktreeId: '20000000-0000-4000-8000-000000000001',
        snippet: BURIED_TEXT,
        source: 'assistant',
        sessionId: SESSION_ID,
      },
    ])
  })

  it('collapses a session to its newest hit and orders sessions by it', () => {
    const matches = search.search({ query: 'pelican' }).matches

    expect(matches.map((match) => match.sessionId)).toEqual([
      '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
      '19e557ea-fa7c-515a-9051-e990f8aa54c6',
      SESSION_ID,
    ])
    expect(matches.map((match) => match.messageCreatedAt)).toEqual([
      NEWEST_SESSION_MATCH_AT,
      RECENT_SESSION_MATCH_AT,
      BURIED_AT,
    ])
  })

  it('bounds the result to the requested limit', () => {
    expect(search.search({ limit: 2, query: 'pelican' }).matches).toHaveLength(2)
    expect(
      search.search({ limit: 1, query: 'pelican' }).matches.map((match) => match.sessionId),
    ).toEqual(['287d7571-b9f0-5489-8ea1-7dc0decb92ee'])
  })

  it('windows the snippet around the match and caps its length', () => {
    const matches = search.search({ query: 'wombat' }).matches
    expect(matches).toHaveLength(1)

    const snippet = matches[0]?.snippet ?? ''
    expect(snippet.length).toBeLessThanOrEqual(ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH)
    expect(snippet).toContain(LONG_MESSAGE_MATCH)
    expect(snippet.startsWith('…')).toBe(true)
  })

  it('treats LIKE wildcards as literal text', () => {
    expect(search.search({ query: '%%' }).matches).toEqual([])
    expect(search.search({ query: '_'.repeat(20) }).matches).toEqual([])
    expect(
      search.search({ query: '%'.repeat(ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH) }).matches,
    ).toEqual([])
  })

  it('rejects an out-of-bounds query before it reaches the database', () => {
    expect(() =>
      search.search({ query: 'x'.repeat(ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH + 1) }),
    ).toThrow()
    expect(() => search.search({ query: 'x' })).toThrow()
    expect(() => search.search({ limit: 5_000, query: 'pelican' })).toThrow()
  })

  it('answers over the route and stays usable after a rejected query', async () => {
    const rejected = await postSearch({
      query: 'x'.repeat(ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH + 1),
    })
    expect(rejected.status).toBe(422)

    const response = await postSearch({ limit: 2, query: 'pelican' })
    expect(response.status).toBe(200)

    const payload = (await response.json()) as OrchestrationSearchSessionsResult
    expect(payload.matches.map((match) => match.sessionId)).toEqual([
      '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
      '19e557ea-fa7c-515a-9051-e990f8aa54c6',
    ])
  })
})

/** The real routes plugin, so the bounds under test are the ones a client meets. */
function createSearchApp(
  database: OrchestrationDatabase,
  sessionSearch: OrchestrationSessionSearchQuery,
) {
  const engine = new OrchestrationEngine(database)
  const git = new GitService(createWorkspacePaths(), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
  const checkpointDiff = new OrchestrationCheckpointDiffQuery(database, git)
  const checkpointHunks = new OrchestrationCheckpointHunks({
    activeRuntimes: async () => [],
    diffs: checkpointDiff,
    git,
    readModel: () => engine.readModelSnapshot(),
  })
  return new Elysia().use(
    orchestrationRoutes(engine, checkpointDiff, sessionSearch, checkpointHunks),
  )
}

function postSearch(body: unknown) {
  return app.handle(
    new Request('http://local/orchestration/session-search', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

/**
 * One project, four sessions of real projected messages. The phrase under test
 * sits at the very start of the busiest session so the search has to reach past
 * the detail window to find it.
 */
function seedEvents() {
  return [
    ...sessionBootstrapEvents(),
    searchMessageEvent({
      createdAt: BURIED_AT,
      messageId: 'message-buried',
      text: BURIED_TEXT,
      sessionId: SESSION_ID,
    }),
    ...Array.from({ length: NOISE_MESSAGE_COUNT }, (_, index) =>
      searchMessageEvent({
        createdAt: noiseCreatedAt(index),
        messageId: `message-noise-${index}`,
        text: `routine status update ${index}`,
        sessionId: SESSION_ID,
      }),
    ),
    searchSessionCreatedEvent({
      createdAt: '2026-05-25T00:00:00.000Z',
      sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6',
    }),
    searchMessageEvent({
      createdAt: '2026-05-25T00:30:00.000Z',
      messageId: 'message-2a',
      role: 'user',
      text: 'the first pelican mention in this session',
      sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6',
    }),
    searchMessageEvent({
      createdAt: RECENT_SESSION_MATCH_AT,
      messageId: 'message-2b',
      text: 'the second pelican mention, which is the newer one',
      sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6',
    }),
    searchSessionCreatedEvent({
      createdAt: '2026-05-26T00:00:00.000Z',
      sessionId: '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
    }),
    searchMessageEvent({
      createdAt: NEWEST_SESSION_MATCH_AT,
      messageId: 'message-3a',
      text: 'a pelican in the newest session',
      sessionId: '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
    }),
    searchSessionCreatedEvent({
      createdAt: '2026-05-20T00:00:00.000Z',
      sessionId: '20ec4a31-6791-57a0-85a7-9ffb0330fa7a',
    }),
    searchMessageEvent({
      createdAt: '2026-05-20T00:30:00.000Z',
      messageId: 'message-4a',
      text: `${'filler '.repeat(300)}${LONG_MESSAGE_MATCH}${' trailing'.repeat(300)}`,
      sessionId: '20ec4a31-6791-57a0-85a7-9ffb0330fa7a',
    }),
  ]
}

function noiseCreatedAt(index: number) {
  return new Date(Date.UTC(2026, 4, 24, 1, index)).toISOString()
}
