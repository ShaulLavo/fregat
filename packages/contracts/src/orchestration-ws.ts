import * as v from 'valibot'
import { environmentIdSchema, projectIdSchema, worktreeIdSchema, sessionIdSchema } from './chat-ids'
import {
  isoDateTimeSchema,
  nonNegativeIntegerSchema,
  trimmedNonEmptyStringSchema,
} from './chat-model'
import { clientOrchestrationCommandSchema } from './orchestration-commands'
import { serverUpdateSchema } from './server-update'
import {
  ORCHESTRATION_SESSION_DETAIL_MAX_PAGE_SIZE,
  orchestrationReplayEventsInputSchema,
  orchestrationReplayEventsResultSchema,
  orchestrationShellStreamItemSchema,
  orchestrationSessionDetailAnchorSchema,
  orchestrationSessionDetailPageSchema,
  orchestrationSessionStreamItemSchema,
  projectRegistrationResultSchema,
} from './orchestration-snapshots'

/**
 * Bumped whenever a shape in this file changes in a way an older peer cannot
 * read. The server reports it in the connection handshake so a client built
 * against a different protocol detects the skew on connect instead of failing
 * later on a frame it cannot parse.
 *
 * 2 — added the `sessionDetailPage` request.
 * 3 — dropped the `shellSnapshot` and `sessionDetailSnapshot` requests. Both are
 *     read over HTTP now: they are large one-shot bodies, and writing one into
 *     the socket head-of-line-blocked every other frame for its duration. The
 *     subscriptions still push snapshot *frames*; only the requests are gone.
 * 4 — added the durable environment identity to the handshake.
 * 8 — added the `server.update` push (staged release, restart phase, live check).
 */
export const ORCHESTRATION_WS_PROTOCOL_VERSION = 8

/**
 * Hard ceiling on one `replayEvents` page. `replayEvents` is client-reachable,
 * so an unbounded read is a request-shaped way to make the server decode the
 * entire event log into memory. Clients page by passing the last sequence they
 * received back as `afterSequence`.
 */
export const ORCHESTRATION_REPLAY_MAX_EVENTS = 1_000

/**
 * How far behind the server's head a subscriber's cursor may be and still be
 * resumed by replay. Past this gap a single snapshot is both cheaper and
 * bounded, so the server resets the client instead of replaying unbounded
 * history.
 */
export const ORCHESTRATION_RESUME_MAX_GAP = 1_000

/**
 * Bounds on server-side session search. The server's SQLite client is
 * synchronous and single-connection, so both the scan input and the response
 * size are bounded: an unbounded search is a request-shaped way for one client
 * to monopolize that connection for every other request in the process.
 */
export const ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH = 2
export const ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH = 200
export const ORCHESTRATION_SESSION_SEARCH_DEFAULT_LIMIT = 20
export const ORCHESTRATION_SESSION_SEARCH_MAX_LIMIT = 50

/** Long enough to read the phrase in context, short enough that fifty of them stay one frame. */
export const ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH = 240

export const orchestrationSessionSearchSourceSchema = v.picklist(['user', 'assistant'])

export const orchestrationSearchSessionsInputSchema = v.object({
  query: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH),
    v.maxLength(ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH),
  ),
  limit: v.optional(
    v.pipe(
      nonNegativeIntegerSchema,
      v.minValue(1),
      v.maxValue(ORCHESTRATION_SESSION_SEARCH_MAX_LIMIT),
    ),
    ORCHESTRATION_SESSION_SEARCH_DEFAULT_LIMIT,
  ),
})

/**
 * One match per session, not per message: the answer to "where did I discuss X"
 * is a session, and a session that says X forty times would otherwise bury every
 * other session out of the bounded result.
 */
export const orchestrationSessionSearchMatchSchema = v.object({
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  worktreeId: worktreeIdSchema,
  source: orchestrationSessionSearchSourceSchema,
  snippet: v.pipe(v.string(), v.maxLength(ORCHESTRATION_SESSION_SEARCH_SNIPPET_MAX_LENGTH)),
  messageCreatedAt: isoDateTimeSchema,
})

export const orchestrationSearchSessionsResultSchema = v.object({
  matches: v.array(orchestrationSessionSearchMatchSchema),
})

export const orchestrationWsRequestIdSchema = trimmedNonEmptyStringSchema
export const orchestrationWsSubscriptionIdSchema = trimmedNonEmptyStringSchema

export const orchestrationWsReplayInputSchema = v.object({
  ...orchestrationReplayEventsInputSchema.entries,
  limit: v.optional(
    v.pipe(nonNegativeIntegerSchema, v.minValue(1), v.maxValue(ORCHESTRATION_REPLAY_MAX_EVENTS)),
  ),
})

/**
 * The wire form of a backwards page read. Anchors and limit carry no defaults
 * here on purpose: the frame says exactly what the client asked for, and
 * `orchestrationSessionDetailPageInputSchema` on the server applies the defaults
 * once, in the one place that owns them.
 */
export const orchestrationWsSessionDetailPageInputSchema = v.object({
  sessionId: sessionIdSchema,
  beforeMessage: v.nullish(orchestrationSessionDetailAnchorSchema),
  beforeActivity: v.nullish(orchestrationSessionDetailAnchorSchema),
  limit: v.optional(
    v.pipe(
      nonNegativeIntegerSchema,
      v.minValue(1),
      v.maxValue(ORCHESTRATION_SESSION_DETAIL_MAX_PAGE_SIZE),
    ),
  ),
})

export const orchestrationWsRequestSchema = v.variant('method', [
  v.object({
    kind: v.literal('request'),
    requestId: orchestrationWsRequestIdSchema,
    method: v.literal('dispatchCommand'),
    command: clientOrchestrationCommandSchema,
  }),
  v.object({
    kind: v.literal('request'),
    requestId: orchestrationWsRequestIdSchema,
    method: v.literal('sessionDetailPage'),
    input: orchestrationWsSessionDetailPageInputSchema,
  }),
  v.object({
    kind: v.literal('request'),
    requestId: orchestrationWsRequestIdSchema,
    method: v.literal('replayEvents'),
    input: orchestrationWsReplayInputSchema,
  }),
  v.object({
    kind: v.literal('request'),
    requestId: orchestrationWsRequestIdSchema,
    method: v.literal('serverConfig'),
  }),
])

/**
 * `afterSequence` is the resume cursor: the highest stream sequence the client
 * has already applied. `0` means "no cursor" and always yields a snapshot.
 * A non-zero cursor is resumed by replaying the events after it, unless the
 * server can no longer serve that range (see `ORCHESTRATION_RESUME_MAX_GAP`),
 * in which case the subscription opens with a snapshot instead. Either way the
 * server emits a `synchronized` frame once the client is caught up to live.
 */
export const orchestrationWsSubscribeSchema = v.variant('method', [
  v.object({
    kind: v.literal('subscribe'),
    subscriptionId: orchestrationWsSubscriptionIdSchema,
    method: v.literal('subscribeShell'),
    afterSequence: v.optional(nonNegativeIntegerSchema, 0),
  }),
  v.object({
    kind: v.literal('subscribe'),
    subscriptionId: orchestrationWsSubscriptionIdSchema,
    method: v.literal('subscribeSession'),
    sessionId: sessionIdSchema,
    afterSequence: v.optional(nonNegativeIntegerSchema, 0),
  }),
])

export const orchestrationWsUnsubscribeSchema = v.object({
  kind: v.literal('unsubscribe'),
  subscriptionId: orchestrationWsSubscriptionIdSchema,
})

export const orchestrationWsPingSchema = v.object({
  kind: v.literal('ping'),
  requestId: orchestrationWsRequestIdSchema,
})

const orchestrationWsSubscriptionAckSchema = v.object({
  kind: v.literal('subscription.ack'),
  subscriptionId: orchestrationWsSubscriptionIdSchema,
  deliveryId: nonNegativeIntegerSchema,
})

export const orchestrationWsClientMessageSchema = v.union([
  orchestrationWsSubscriptionAckSchema,
  orchestrationWsRequestSchema,
  orchestrationWsSubscribeSchema,
  orchestrationWsUnsubscribeSchema,
  orchestrationWsPingSchema,
])

/**
 * Emitted once per subscription, after the snapshot or the catch-up replay and
 * before the first live delta. It is what lets a client distinguish "still
 * catching up" from "live": until it arrives, everything received is history.
 */
export const orchestrationStreamSynchronizedItemSchema = v.object({
  kind: v.literal('synchronized'),
  sequence: nonNegativeIntegerSchema,
})

export const orchestrationShellStreamFrameSchema = v.union([
  orchestrationShellStreamItemSchema,
  orchestrationStreamSynchronizedItemSchema,
])

export const orchestrationSessionStreamFrameSchema = v.union([
  orchestrationSessionStreamItemSchema,
  orchestrationStreamSynchronizedItemSchema,
])

export const orchestrationWsErrorSchema = v.object({
  code: v.optional(v.string()),
  message: v.string(),
  name: v.optional(v.string()),
  status: v.optional(nonNegativeIntegerSchema),
})

export const orchestrationWsServerConfigSchema = v.object({
  environmentId: environmentIdSchema,
  protocolVersion: nonNegativeIntegerSchema,
  serverVersion: trimmedNonEmptyStringSchema,
  /** New per process: a change means the server restarted and cursors are stale. */
  serverInstanceId: trimmedNonEmptyStringSchema,
  startedAt: isoDateTimeSchema,
  capabilities: v.object({
    resume: v.boolean(),
    synchronizedMarker: v.boolean(),
  }),
  limits: v.object({
    replayMaxEvents: nonNegativeIntegerSchema,
    resumeMaxGap: nonNegativeIntegerSchema,
  }),
})

/** Pushed by the server as the first frame on an authenticated connection. */
export const orchestrationWsConnectedMessageSchema = v.object({
  kind: v.literal('connected'),
  config: orchestrationWsServerConfigSchema,
})

export const orchestrationWsResponseMessageSchema = v.variant('ok', [
  v.object({
    kind: v.literal('response'),
    requestId: orchestrationWsRequestIdSchema,
    ok: v.literal(true),
    data: v.unknown(),
  }),
  v.object({
    kind: v.literal('response'),
    requestId: orchestrationWsRequestIdSchema,
    ok: v.literal(false),
    error: orchestrationWsErrorSchema,
  }),
])

/**
 * The wire form of what dispatching a command returns. `sequence` is the stream
 * position the command's events landed at; `deduped` says the command id had
 * already been accepted, so nothing new was appended and `sequence` is the
 * earlier attempt's. Both are what a caller needs to know where to resume its
 * projection from — nothing else about the command's receipt crosses the wire.
 */
export const orchestrationDispatchResultSchema = v.object({
  deduped: v.boolean(),
  sequence: nonNegativeIntegerSchema,
  result: v.nullable(projectRegistrationResultSchema),
})

/**
 * One result schema per request method. The response envelope carries no method
 * — `requestId` is what pairs a response with its request — so without this map
 * a result shape exists only in whatever each caller happened to assert, and
 * client and server agree by coincidence. Keyed here, both sides read the same
 * entry and a change to one is a build error in the other.
 */
export const ORCHESTRATION_WS_RESULTS = {
  dispatchCommand: orchestrationDispatchResultSchema,
  replayEvents: orchestrationReplayEventsResultSchema,
  serverConfig: orchestrationWsServerConfigSchema,
  sessionDetailPage: orchestrationSessionDetailPageSchema,
} satisfies Record<OrchestrationWsRequest['method'], v.GenericSchema>

export const orchestrationWsSubscriptionItemSchema = v.union([
  orchestrationShellStreamItemSchema,
  orchestrationSessionStreamItemSchema,
  orchestrationStreamSynchronizedItemSchema,
])

export const orchestrationWsSubscriptionNextMessageSchema = v.object({
  kind: v.literal('subscription.next'),
  deliveryId: nonNegativeIntegerSchema,
  subscriptionId: orchestrationWsSubscriptionIdSchema,
  item: orchestrationWsSubscriptionItemSchema,
})

export const orchestrationWsSubscriptionErrorMessageSchema = v.object({
  kind: v.literal('subscription.error'),
  subscriptionId: orchestrationWsSubscriptionIdSchema,
  error: orchestrationWsErrorSchema,
})

export const orchestrationWsSubscriptionCompleteMessageSchema = v.object({
  kind: v.literal('subscription.complete'),
  subscriptionId: orchestrationWsSubscriptionIdSchema,
})

export const orchestrationWsPongMessageSchema = v.object({
  kind: v.literal('pong'),
  requestId: orchestrationWsRequestIdSchema,
})

/** The server's staged-update state, sent after `connected` and on every change (Plan 148). */
export const orchestrationWsServerUpdateMessageSchema = v.object({
  kind: v.literal('server.update'),
  update: serverUpdateSchema,
})

export const orchestrationWsServerMessageSchema = v.union([
  orchestrationWsConnectedMessageSchema,
  orchestrationWsResponseMessageSchema,
  orchestrationWsSubscriptionNextMessageSchema,
  orchestrationWsSubscriptionErrorMessageSchema,
  orchestrationWsSubscriptionCompleteMessageSchema,
  orchestrationWsPongMessageSchema,
  orchestrationWsServerUpdateMessageSchema,
])

export type OrchestrationStreamSynchronizedItem = v.InferOutput<
  typeof orchestrationStreamSynchronizedItemSchema
>
export type OrchestrationShellStreamFrame = v.InferOutput<
  typeof orchestrationShellStreamFrameSchema
>
export type OrchestrationSessionStreamFrame = v.InferOutput<
  typeof orchestrationSessionStreamFrameSchema
>
export type OrchestrationSearchSessionsInput = v.InferInput<
  typeof orchestrationSearchSessionsInputSchema
>
export type OrchestrationSearchSessionsResult = v.InferOutput<
  typeof orchestrationSearchSessionsResultSchema
>
export type OrchestrationSessionSearchMatch = v.InferOutput<
  typeof orchestrationSessionSearchMatchSchema
>
export type OrchestrationSessionSearchSource = v.InferOutput<
  typeof orchestrationSessionSearchSourceSchema
>
export type OrchestrationWsClientMessage = v.InferOutput<typeof orchestrationWsClientMessageSchema>
export type OrchestrationWsConnectedMessage = v.InferOutput<
  typeof orchestrationWsConnectedMessageSchema
>
export type OrchestrationWsError = v.InferOutput<typeof orchestrationWsErrorSchema>
export type OrchestrationWsReplayInput = v.InferOutput<typeof orchestrationWsReplayInputSchema>
export type OrchestrationWsSessionDetailPageInput = v.InferOutput<
  typeof orchestrationWsSessionDetailPageInputSchema
>
export type OrchestrationWsRequest = v.InferOutput<typeof orchestrationWsRequestSchema>
export type OrchestrationWsRequestId = v.InferOutput<typeof orchestrationWsRequestIdSchema>
export type OrchestrationDispatchResult = v.InferOutput<typeof orchestrationDispatchResultSchema>
/** The single request variant for one method — what a caller builds and sends. */
export type OrchestrationWsRequestOf<M extends OrchestrationWsRequest['method']> = Extract<
  OrchestrationWsRequest,
  { method: M }
>
/**
 * Mapped rather than a bare indexed access on purpose: written this way, a
 * method added to `orchestrationWsRequestSchema` without an entry in
 * `ORCHESTRATION_WS_RESULTS` is a compile error here.
 */
type OrchestrationWsResults = {
  [M in OrchestrationWsRequest['method']]: v.InferOutput<(typeof ORCHESTRATION_WS_RESULTS)[M]>
}
export type OrchestrationWsResult<M extends OrchestrationWsRequest['method']> =
  OrchestrationWsResults[M]
export type OrchestrationWsResponseMessage = v.InferOutput<
  typeof orchestrationWsResponseMessageSchema
>
export type OrchestrationWsServerConfig = v.InferOutput<typeof orchestrationWsServerConfigSchema>
export type OrchestrationWsServerMessage = v.InferOutput<typeof orchestrationWsServerMessageSchema>
export type OrchestrationWsSubscribe = v.InferOutput<typeof orchestrationWsSubscribeSchema>
export type OrchestrationWsSubscriptionId = v.InferOutput<
  typeof orchestrationWsSubscriptionIdSchema
>
export type OrchestrationWsSubscriptionItem = v.InferOutput<
  typeof orchestrationWsSubscriptionItemSchema
>
