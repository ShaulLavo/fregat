import * as v from 'valibot'
import { modelSelectionSchema, worktreeIdSchema } from '@workspace/contracts'
import { booleanQueryValueSchema, pathSchema } from '../fs/contracts'

export const gitPathQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
})

export const gitPathBodySchema = v.object({
  path: v.optional(pathSchema, ''),
})

export const gitDiffQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  staged: v.optional(booleanQueryValueSchema, 'false'),
})

const gitObjectIdSchema = v.pipe(v.string(), v.regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i))

export const gitHistoryBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  search: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(1024),
      v.check((value) => !value.includes('\0') && !value.includes('\r') && !value.includes('\n')),
    ),
    '',
  ),
  ref: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(1024),
      v.regex(/^(?:all|HEAD|refs\/(?:heads|remotes|tags)\/[^\s\p{Cc}]+)$/u),
    ),
    'all',
  ),
  cursor: v.optional(
    v.object({
      tips: v.pipe(v.array(gitObjectIdSchema), v.minLength(1), v.maxLength(20000)),
      skip: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100000000)),
    }),
  ),
})

export const gitHistoryCommitQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  commit: gitObjectIdSchema,
})

export type GitHistoryBody = v.InferOutput<typeof gitHistoryBodySchema>
export type GitHistoryCommitQuery = v.InferOutput<typeof gitHistoryCommitQuerySchema>

/**
 * Refs reach git as argv, so a leading dash would be read as a flag and a space
 * would split into two arguments. The allowed shape is git's own ref grammar
 * narrowed to what a base or branch name ever needs.
 */
const gitRefNameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(255),
  v.regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/),
)

export const gitBlobDiffQuerySchema = v.object({
  path: pathSchema,
  oldPath: v.optional(pathSchema),
  oldObjectId: v.optional(gitObjectIdSchema),
  newObjectId: v.optional(gitObjectIdSchema),
})

export const gitFileQuerySchema = v.object({
  path: pathSchema,
  ref: v.optional(gitRefNameSchema, 'HEAD'),
})

export const gitPathsBodySchema = v.object({
  paths: v.array(pathSchema),
})

export const gitApplyPatchBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  patch: v.string(),
  reverse: v.optional(v.boolean(), false),
  target: v.optional(v.picklist(['index', 'worktree']), 'worktree'),
})

export const gitCommitBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  message: v.string(),
  /** `message-file` commits what the user wrote in COMMIT_EDITMSG and ignores `message`. */
  source: v.optional(v.picklist(['input', 'message-file']), 'input'),
})

const gitCommitMessageSourceSchema = v.picklist(['staged', 'working'])

export const gitCommitMessageResultSchema = v.object({
  message: v.string(),
  modelSelection: modelSelectionSchema,
  source: gitCommitMessageSourceSchema,
})

export const gitCheckoutBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  branch: gitRefNameSchema,
})

export const gitCreateBranchBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  branch: gitRefNameSchema,
  checkout: v.optional(v.boolean(), true),
  startPoint: v.optional(gitRefNameSchema),
})

export const gitWorktreePrepareBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  worktreeId: worktreeIdSchema,
})

export const gitWorktreeCreateBodySchema = v.object({
  ...gitWorktreePrepareBodySchema.entries,
  baseCommit: gitObjectIdSchema,
  branch: gitRefNameSchema,
})

export const gitWorktreeTargetSchema = v.object({
  ...gitWorktreePrepareBodySchema.entries,
  worktreePath: pathSchema,
  pathKind: v.optional(v.picklist(['id-derived', 'legacy'])),
})

export const gitWorktreeRemoveBodySchema = v.variant('mode', [
  v.object({ ...gitWorktreeTargetSchema.entries, mode: v.literal('safe') }),
  v.object({
    ...gitWorktreeTargetSchema.entries,
    mode: v.literal('discard-changes'),
    expectedHead: gitObjectIdSchema,
    expectedStatusFingerprint: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  }),
])

/**
 * The title and body reach `gh` as argv, not a shell, so no quoting is needed —
 * only a length ceiling, because a runaway body would be an unbounded argument.
 */
export const gitCreatePullRequestBodySchema = v.object({
  path: v.optional(pathSchema, ''),
  base: v.optional(gitRefNameSchema),
  body: v.optional(v.pipe(v.string(), v.maxLength(60_000)), ''),
  draft: v.optional(v.boolean(), false),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
})

export const gitBranchDiffQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  base: v.optional(gitRefNameSchema),
})

export type GitBlobDiffQuery = v.InferOutput<typeof gitBlobDiffQuerySchema>
export type GitPathsBody = v.InferOutput<typeof gitPathsBodySchema>
export type GitApplyPatchBody = v.InferOutput<typeof gitApplyPatchBodySchema>
type ParsedGitCommitBody = v.InferOutput<typeof gitCommitBodySchema>
/** `source` stays optional for in-process callers; the route's parse fills the default. */
export type GitCommitBody = Omit<ParsedGitCommitBody, 'source'> &
  Partial<Pick<ParsedGitCommitBody, 'source'>>
export type GitCommitMessageResult = v.InferOutput<typeof gitCommitMessageResultSchema>
export type GitCommitMessageSource = v.InferOutput<typeof gitCommitMessageSourceSchema>
export type GitCheckoutBody = v.InferOutput<typeof gitCheckoutBodySchema>
export type GitCreateBranchBody = v.InferOutput<typeof gitCreateBranchBodySchema>
export type GitWorktreeCreateBody = v.InferOutput<typeof gitWorktreeCreateBodySchema>
export type GitWorktreeRemoveBody = v.InferOutput<typeof gitWorktreeRemoveBodySchema>
export type GitBranchDiffQuery = v.InferOutput<typeof gitBranchDiffQuerySchema> & {
  baseCommit?: string
}
export type GitCreatePullRequestBody = v.InferOutput<typeof gitCreatePullRequestBodySchema>

export type GitWorktreePrepareBody = v.InferOutput<typeof gitWorktreePrepareBodySchema>
export type GitWorktreeTarget = v.InferOutput<typeof gitWorktreeTargetSchema>
