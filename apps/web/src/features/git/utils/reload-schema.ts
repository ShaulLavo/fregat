import * as v from 'valibot'

const scroll = v.nullable(v.object({ top: v.number(), left: v.number() }))
const selection = v.object({
  anchorOffset: v.number(),
  headOffset: v.number(),
  startOffset: v.number(),
  endOffset: v.number(),
  affinity: v.picklist(['before', 'after']),
})
const selections = v.optional(v.pipe(v.array(selection), v.maxLength(100)))
const diffViewSchema = v.object({
  expanded: v.array(v.string()),
  old: scroll,
  new: scroll,
  stacked: scroll,
  oldSelections: selections,
  newSelections: selections,
  stackedSelections: selections,
  layout: v.optional(v.record(v.string(), v.number())),
})
export const gitViewSchema = v.object({
  root: v.nullable(v.string()),
  list: v.optional(v.object({ activeId: v.nullable(v.string()), scrollTop: v.number() })),
  diff: v.optional(v.object({ identity: v.string(), view: diffViewSchema })),
})
export type GitViewRecord = v.InferOutput<typeof gitViewSchema>
export type DiffReloadView = v.InferOutput<typeof diffViewSchema>
