import * as v from 'valibot'

const status = v.picklist([
  'added',
  'deleted',
  'ignored',
  'modified',
  'renamed',
  'untracked',
  'conflicted',
])
const side = v.union([status, v.literal('unmodified')])
const lineStat = v.object({ additions: v.number(), deletions: v.number() })
const statusSchema = v.object({
  repository: v.nullable(
    v.object({
      branch: v.nullable(v.string()),
      commit: v.nullable(v.string()),
      ahead: v.number(),
      behind: v.number(),
      path: v.string(),
    }),
  ),
  files: v.pipe(
    v.array(
      v.object({
        path: v.string(),
        oldPath: v.optional(v.string()),
        index: side,
        worktree: side,
        status,
        lines: v.optional(
          v.object({ staged: v.optional(lineStat), worktree: v.optional(lineStat) }),
        ),
      }),
    ),
    v.maxLength(1500),
  ),
})
const change = v.object({
  type: v.picklist(['added', 'deleted', 'context']),
  oldLine: v.nullable(v.number()),
  newLine: v.nullable(v.number()),
  text: v.string(),
})
const diffsSchema = v.pipe(
  v.array(
    v.object({
      path: v.string(),
      oldPath: v.optional(v.string()),
      oldFileMissing: v.optional(v.boolean()),
      newFileMissing: v.optional(v.boolean()),
      oldObjectId: v.optional(v.string()),
      newObjectId: v.optional(v.string()),
      oldText: v.optional(v.string()),
      newText: v.optional(v.string()),
      staged: v.boolean(),
      patch: v.string(),
      hunks: v.array(
        v.object({
          header: v.string(),
          oldStart: v.number(),
          oldLines: v.number(),
          newStart: v.number(),
          newLines: v.number(),
          patch: v.string(),
          changes: v.array(change),
        }),
      ),
    }),
  ),
  v.maxLength(200),
)
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
  view: v.object({ activeId: v.nullable(v.string()), scrollTop: v.number() }),
})
export const reloadSchema = v.object({
  root: v.nullable(v.string()),
  observedAt: v.number(),
  status: v.optional(statusSchema),
  diff: v.optional(
    v.object({
      identity: v.string(),
      diffs: v.optional(diffsSchema),
      view: v.optional(diffViewSchema),
    }),
  ),
})
export type GitViewRecord = v.InferOutput<typeof gitViewSchema>
export type GitReloadRecord = v.InferOutput<typeof reloadSchema> & {
  view?: v.InferOutput<typeof gitViewSchema>['view']
}
export type DiffReloadView = v.InferOutput<typeof diffViewSchema>
