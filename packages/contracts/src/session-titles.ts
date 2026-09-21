import * as v from 'valibot'

const sessionTitleStateSchema = v.object({
  source: v.picklist(['manual', 'generated']),
  version: v.string(),
  needsRefinement: v.boolean(),
})

const sessionTitleRegenerationSchema = v.object({
  requestId: v.string(),
  startedAt: v.pipe(v.string(), v.isoTimestamp()),
})

export const sessionTitleEntries = {
  titleState: v.optional(v.nullable(sessionTitleStateSchema)),
  titleRegeneration: v.optional(v.nullable(sessionTitleRegenerationSchema)),
  titleGenerationError: v.optional(v.nullable(v.string())),
} as const
