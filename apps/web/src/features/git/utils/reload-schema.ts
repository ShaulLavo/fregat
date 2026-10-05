import * as v from 'valibot'
import {
  gitSnapshotTargetSchema,
  gitInputRevisionSchema,
  type GitSnapshotTarget,
  type GitInputRevision,
} from '@workspace/contracts'

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
const identitySchema = v.variant('kind', [
  v.object({
    kind: v.literal('snapshot'),
    target: gitSnapshotTargetSchema,
    revision: gitInputRevisionSchema,
  }),
  v.object({ kind: v.literal('checkpoint'), identity: v.string() }),
])
export type DiffReloadIdentity =
  | {
      readonly kind: 'snapshot'
      readonly target: GitSnapshotTarget
      readonly revision: GitInputRevision
    }
  | { readonly kind: 'checkpoint'; readonly identity: string }

export const gitViewSchema = v.object({
  root: v.nullable(v.string()),
  list: v.optional(v.object({ activeId: v.nullable(v.string()), scrollTop: v.number() })),
  diff: v.fallback(
    v.optional(v.object({ identity: identitySchema, view: diffViewSchema })),
    undefined,
  ),
})
export type GitViewRecord = Omit<v.InferOutput<typeof gitViewSchema>, 'diff'> & {
  diff?: { identity: DiffReloadIdentity; view: DiffReloadView }
}
export type DiffReloadView = v.InferOutput<typeof diffViewSchema>
