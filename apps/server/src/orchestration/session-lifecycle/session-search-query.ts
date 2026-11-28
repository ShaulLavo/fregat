import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import * as v from 'valibot'
import {
  ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH,
  orchestrationSearchSessionsInputSchema,
  orchestrationSearchSessionsResultSchema,
  type OrchestrationSearchSessionsInput,
  type OrchestrationSearchSessionsResult,
} from '@workspace/contracts'
import { projectionSessionMessages, projectionSessions, projectionWorktrees } from '../../db/schema'
import type { OrchestrationDatabase } from '../event-store'

const ELLIPSIS = '…'

/** Characters kept before the match so the snippet reads as a sentence, not a fragment. */
const SNIPPET_LEAD_CHARS = 40

/**
 * Searches persisted message content, which is the only place an answer to
 * "where did I discuss X" exists — titles and branches were never written by
 * the conversation. Every query runs against the projection, so a match is
 * always something the session actually said.
 */
export class OrchestrationSessionSearchQuery {
  /**
   * Required, like every other query in this folder. A default that reached for
   * the process-wide database made a forgotten wiring site look like it worked:
   * the route answered from the developer's real SQLite file even when the app
   * had been handed an in-memory one, so a test could pass for the wrong reason.
   */
  private readonly database: OrchestrationDatabase

  constructor(database: OrchestrationDatabase) {
    this.database = database
  }

  search(input: OrchestrationSearchSessionsInput): OrchestrationSearchSessionsResult {
    const query = v.parse(orchestrationSearchSessionsInputSchema, input)
    const rows = this.newestMatchPerSession(query.query, query.limit)

    return v.parse(orchestrationSearchSessionsResultSchema, {
      matches: rows.map((row) => ({
        messageCreatedAt: row.messageCreatedAt,
        projectId: row.projectId,
        worktreeId: row.worktreeId,
        snippet: buildSnippet(row.text, query.query),
        source: row.role,
        sessionId: row.sessionId,
      })),
    })
  }

  /**
   * `max()` with bare columns is SQLite's documented "row of the extreme value"
   * rule: with exactly one min/max aggregate, the non-aggregated columns come
   * from the row that produced it. That is what collapses a session to its most
   * recent hit in a single pass instead of a per-session follow-up query.
   */
  private newestMatchPerSession(query: string, limit: number) {
    const newestMatchAt = sql<string>`max(${projectionSessionMessages.createdAt})`

    return this.database
      .select({
        messageCreatedAt: newestMatchAt,
        projectId: projectionWorktrees.projectId,
        worktreeId: projectionSessions.worktreeId,
        role: projectionSessionMessages.role,
        text: projectionSessionMessages.text,
        sessionId: projectionSessionMessages.sessionId,
      })
      .from(projectionSessionMessages)
      .innerJoin(
        projectionSessions,
        eq(projectionSessions.sessionId, projectionSessionMessages.sessionId),
      )
      .innerJoin(
        projectionWorktrees,
        eq(projectionWorktrees.worktreeId, projectionSessions.worktreeId),
      )
      .where(
        and(
          isNull(projectionSessions.deletedAt),
          // `system` messages are plumbing the user never wrote or read, and
          // the match contract only has a source for the two that they did.
          ne(projectionSessionMessages.role, 'system'),
          containsLiteral(projectionSessionMessages.text, query),
        ),
      )
      .groupBy(projectionSessionMessages.sessionId)
      .orderBy(desc(newestMatchAt))
      .limit(limit)
      .all()
  }
}

/**
 * `LIKE` reads `%` and `_` as wildcards, so an unescaped query of two percent
 * signs would pass the length bound and still match every message ever stored.
 * Escaping keeps the pattern literal: the contract bounds the input, this
 * bounds what the input can ask the scan to do.
 */
function containsLiteral(column: SQLiteColumn, query: string) {
  return sql`${column} like ${`%${escapeLikePattern(query)}%`} escape '\\'`
}

function escapeLikePattern(query: string) {
  return query.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * A window around the first occurrence rather than the head of the message: a
 * hit two thousand characters into a long answer has to be visible in the
 * result, or the search cannot be trusted to have found anything.
 */
function buildSnippet(text: string, query: string) {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  const matchIndex = collapsed.toLowerCase().indexOf(query.toLowerCase())
  const start = Math.max(0, Math.max(matchIndex, 0) - SNIPPET_LEAD_CHARS)
  const lead = start > 0 ? ELLIPSIS : ''
  const budget = ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH - lead.length
  const tail = collapsed.slice(start)
  if (tail.length <= budget) return lead + tail

  return lead + tail.slice(0, budget - ELLIPSIS.length) + ELLIPSIS
}
