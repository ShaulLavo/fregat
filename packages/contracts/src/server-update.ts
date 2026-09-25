import * as v from 'valibot'
import { sessionIdSchema } from './chat-ids'
import { isoDateTimeSchema, trimmedNonEmptyStringSchema } from './chat-model'

/** A release `deploy --server` staged; it goes live when someone clicks Restart (Plan 148). */
export const stagedReleaseSchema = v.object({
  release: trimmedNonEmptyStringSchema,
  stagedAt: isoDateTimeSchema,
})

/** A catalog error as the server serialized it, so its copy stays server-side. */
export const serverUpdateErrorSchema = v.object({
  code: trimmedNonEmptyStringSchema,
  message: v.string(),
  why: v.optional(v.string()),
  fix: v.optional(v.string()),
})

/** The post-restart live check of the served release. */
export const liveCheckVerdictSchema = v.object({
  release: trimmedNonEmptyStringSchema,
  status: v.picklist(['passed', 'failed']),
  at: isoDateTimeSchema,
  error: v.nullable(serverUpdateErrorSchema),
})

export const serverUpdatePhaseSchema = v.picklist(['serving', 'restarting'])

export const serverUpdateSchema = v.object({
  phase: serverUpdatePhaseSchema,
  pending: v.nullable(stagedReleaseSchema),
  liveCheck: v.nullable(liveCheckVerdictSchema),
})

/** What a restart would interrupt in a session. */
export const busySessionStateSchema = v.picklist([
  'starting',
  'running',
  'waiting',
  'rewinding',
  'background',
])

export const busySessionSchema = v.object({
  sessionId: sessionIdSchema,
  title: v.string(),
  projectTitle: v.nullable(v.string()),
  state: busySessionStateSchema,
})

/** The sessions the person agreed to interrupt; the first click sends none. */
export const serverRestartInputSchema = v.object({
  interrupt: v.pipe(v.array(sessionIdSchema), v.maxLength(1000)),
})

export const serverRestartResultSchema = v.variant('restarting', [
  v.object({ restarting: v.literal(true) }),
  v.object({ restarting: v.literal(false), busy: v.array(busySessionSchema) }),
])

export type StagedRelease = v.InferOutput<typeof stagedReleaseSchema>
export type ServerUpdateError = v.InferOutput<typeof serverUpdateErrorSchema>
export type LiveCheckVerdict = v.InferOutput<typeof liveCheckVerdictSchema>
export type ServerUpdatePhase = v.InferOutput<typeof serverUpdatePhaseSchema>
export type ServerUpdate = v.InferOutput<typeof serverUpdateSchema>
export type BusySessionState = v.InferOutput<typeof busySessionStateSchema>
export type BusySession = v.InferOutput<typeof busySessionSchema>
export type ServerRestartInput = v.InferOutput<typeof serverRestartInputSchema>
export type ServerRestartResult = v.InferOutput<typeof serverRestartResultSchema>
