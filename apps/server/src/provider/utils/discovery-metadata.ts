import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

export const discoveryInputSchema = v.object({
  cwd: v.pipe(v.string(), v.minLength(1)),
  limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
  offset: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

const discoveredSessionSchema = v.object({
  sessionId: sessionIdSchema,
  cwd: v.nullable(v.string()),
  title: v.pipe(v.string(), v.trim(), v.minLength(1)),
  sourceUpdatedAt: v.pipe(v.string(), v.isoTimestamp()),
  gitBranch: v.nullable(v.string()),
})

export const discoveredSessionsSchema = v.array(discoveredSessionSchema)
