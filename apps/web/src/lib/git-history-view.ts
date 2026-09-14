import * as v from 'valibot'

export const gitHistoryViewSchema = v.object({
  refName: v.optional(v.string(), 'all'),
  search: v.optional(v.pipe(v.string(), v.maxLength(1024)), ''),
  selected: v.optional(
    v.nullable(v.pipe(v.string(), v.regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/))),
    null,
  ),
  expanded: v.optional(v.boolean(), false),
  pageCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  scrollTop: v.optional(v.pipe(v.number(), v.minValue(0)), 0),
  detailsScrollTop: v.optional(v.pipe(v.number(), v.minValue(0)), 0),
})

export type GitHistoryView = v.InferOutput<typeof gitHistoryViewSchema>

export function createDefaultGitHistoryView(): GitHistoryView {
  return v.parse(gitHistoryViewSchema, {})
}
