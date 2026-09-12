import { Elysia } from 'elysia'
import * as v from 'valibot'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  worktreeIdSchema,
  providerInstanceIdSchema,
  orchestrationSearchSessionsInputSchema,
  clientOrchestrationCommandSchema,
  orchestrationReplayEventsInputSchema,
  sessionIdSchema,
} from '@workspace/contracts'

import type { OrchestrationEngine } from './engine'
import type { OrchestrationCheckpointDiffQuery } from './checkpoint-diff-query'
import type { OrchestrationSessionSearchQuery } from './session-search-query'
import { observeRequestOperation } from '../observability'
import { chatOperationContext, orchestrationReplaySummary } from './orchestration-logging'

const sessionDetailQuerySchema = v.object({
  sessionId: sessionIdSchema,
})

const turnCountQueryValueSchema = v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0))

/** Query strings arrive as text; only the exact "true" opts in. */
const booleanQueryValueSchema = v.pipe(
  v.string(),
  v.transform((value) => value === 'true'),
)

const turnDiffQuerySchema = v.object({
  fromTurnCount: turnCountQueryValueSchema,
  ignoreWhitespace: v.optional(booleanQueryValueSchema),
  sessionId: sessionIdSchema,
  toTurnCount: turnCountQueryValueSchema,
})

const fullSessionDiffQuerySchema = v.object({
  ignoreWhitespace: v.optional(booleanQueryValueSchema),
  sessionId: sessionIdSchema,
  toTurnCount: turnCountQueryValueSchema,
})

export function orchestrationRoutes(
  engine: OrchestrationEngine,
  checkpointDiff: OrchestrationCheckpointDiffQuery,
  sessionSearch: OrchestrationSessionSearchQuery,
) {
  return new Elysia({ name: 'orchestration-routes' }).group('/orchestration', (app) =>
    app
      .get('/session-import', () => engine.sessionImportSources())
      .post(
        '/session-import',
        ({ body, request, server }) => {
          // A local history import can outlast Bun's idle HTTP timeout.
          server?.timeout(request, 0)
          return observeRequestOperation(
            chatOperationContext('orchestration.session_import', {
              providerInstanceId: body.providerInstanceId,
            }),
            () => engine.importSessions(body.providerInstanceId),
            (result) => ({
              scanned: result.scanned,
              imported: result.imported,
              refreshed: result.refreshed,
              messageCount: result.messages,
              failureCount: result.failures.length,
              skipped: result.skipped,
            }),
          )
        },
        { body: v.object({ providerInstanceId: providerInstanceIdSchema }) },
      )
      .post(
        '/commands',
        ({ body }) =>
          observeRequestOperation(
            chatOperationContext('orchestration.commands', {
              commandId: body.commandId,
              commandType: body.type,
            }),
            async () => engine.dispatchClientCommand(body),
            (result) => ({
              deduped: result.deduped,
              sequence: result.sequence,
            }),
          ),
        {
          body: clientOrchestrationCommandSchema,
        },
      )
      .get(
        '/worktree-cleanup-preview',
        ({ query }) => engine.worktreeCleanupPreview(query.worktreeId),
        {
          query: v.object({ worktreeId: worktreeIdSchema }),
        },
      )
      .get(
        '/worktree-missing-preview',
        ({ query }) => engine.worktreeMissingPreview(query.worktreeId),
        {
          query: v.object({ worktreeId: worktreeIdSchema }),
        },
      )
      .get('/shell-snapshot', () =>
        observeRequestOperation(
          chatOperationContext('orchestration.shell_snapshot'),
          async () => engine.shellSnapshot(),
          (snapshot) => ({
            projectCount: snapshot.projects.length,
            snapshotSequence: snapshot.snapshotSequence,
            sessionCount: snapshot.sessions.length,
          }),
        ),
      )
      .get(
        '/session-detail',
        ({ query }) =>
          observeRequestOperation(
            chatOperationContext('orchestration.session_detail_snapshot', {
              sessionId: query.sessionId,
            }),
            async () => engine.sessionDetailSnapshot(query.sessionId),
            (snapshot) => ({
              activityCount: snapshot.session.activities.length,
              // A full window means the session is longer than the snapshot: the
              // rest is reachable only if the client pages backwards, so these
              // are the fields that tell a truncated timeline from a short one.
              activityWindowFull:
                snapshot.session.activities.length === ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
              messageCount: snapshot.session.messages.length,
              messageWindowFull:
                snapshot.session.messages.length === ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
              snapshotSequence: snapshot.snapshotSequence,
              windowSize: ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
            }),
          ),
        {
          query: sessionDetailQuerySchema,
        },
      )
      .post(
        '/session-search',
        ({ body }) =>
          observeRequestOperation(
            // The query text is user content and stays off the wide event; its
            // length is what explains a slow scan or a bounds rejection.
            chatOperationContext('orchestration.session_search', {
              limit: body.limit,
              queryLength: body.query.length,
            }),
            async () => {
              await engine.ready
              return sessionSearch.search(body)
            },
            (result) => ({ matchCount: result.matches.length }),
          ),
        {
          body: orchestrationSearchSessionsInputSchema,
        },
      )
      .get(
        '/turn-diff',
        ({ query }) =>
          observeRequestOperation(
            chatOperationContext('orchestration.turn_diff', {
              fromTurnCount: query.fromTurnCount,
              ignoreWhitespace: query.ignoreWhitespace ?? false,
              sessionId: query.sessionId,
              toTurnCount: query.toTurnCount,
            }),
            async () => {
              await engine.ready
              return checkpointDiff.turnDiff(query)
            },
            (diffs) => ({ diffCount: diffs.length }),
          ),
        {
          query: turnDiffQuerySchema,
        },
      )
      .get(
        '/full-session-diff',
        ({ query }) =>
          observeRequestOperation(
            chatOperationContext('orchestration.full_session_diff', {
              ignoreWhitespace: query.ignoreWhitespace ?? false,
              sessionId: query.sessionId,
              toTurnCount: query.toTurnCount,
            }),
            async () => {
              await engine.ready
              return checkpointDiff.fullSessionDiff(query)
            },
            (diffs) => ({ diffCount: diffs.length }),
          ),
        {
          query: fullSessionDiffQuerySchema,
        },
      )
      .post(
        '/replay',
        ({ body }) =>
          observeRequestOperation(
            chatOperationContext('orchestration.replay', orchestrationReplaySummary(body)),
            async () => engine.replay(body),
            (result) => ({
              eventCount: result.events.length,
              maxSequence: result.events.at(-1)?.sequence ?? body.afterSequence,
            }),
          ),
        {
          body: orchestrationReplayEventsInputSchema,
        },
      ),
  )
}
