import * as v from 'valibot'
import {
  gitSnapshotTargetSchema,
  gitInputRevisionSchema,
  type GitSnapshotTarget,
  type GitInputRevision,
} from '@workspace/contracts'

const sourceAnchor = v.object({
  kind: v.literal('source'),
  side: v.picklist(['old', 'new']),
  line: v.number(),
  character: v.number(),
})
const displayAnchor = v.object({
  kind: v.literal('display'),
  region: v.nullable(v.string()),
  hunk: v.nullable(v.number()),
  row: v.number(),
  character: v.number(),
})
const anchor = v.variant('kind', [sourceAnchor, displayAnchor])
const selection = v.object({
  anchor,
  head: anchor,
  affinity: v.picklist(['before', 'after']),
})
const paneAnchors = v.nullable(
  v.object({
    selections: v.pipe(v.array(selection), v.maxLength(100), v.readonly()),
    viewport: v.nullable(v.object({ anchor, withinRow: v.number() })),
    left: v.number(),
  }),
)
const diffViewSchema = v.object({
  expanded: v.pipe(v.array(v.string()), v.readonly()),
  old: paneAnchors,
  new: paneAnchors,
  stacked: paneAnchors,
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
