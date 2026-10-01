import type { GitPullRequestComment } from '@workspace/contracts'
import * as v from 'valibot'
import { parseForgeJson } from './cli'
import type { ForgeContext } from './types'

const threadSchema = v.object({
  id: v.pipe(v.number(), v.integer()),
  isDeleted: v.optional(v.nullable(v.boolean())),
  threadContext: v.optional(v.nullable(v.object({ filePath: v.optional(v.nullable(v.string())) }))),
  comments: v.optional(
    v.nullable(
      v.array(
        v.object({
          id: v.optional(v.nullable(v.pipe(v.number(), v.integer()))),
          content: v.optional(v.nullable(v.string())),
          publishedDate: v.optional(v.nullable(v.string())),
          isDeleted: v.optional(v.nullable(v.boolean())),
          commentType: v.optional(v.nullable(v.string())),
          author: v.optional(
            v.nullable(v.object({ displayName: v.optional(v.nullable(v.string())) })),
          ),
        }),
      ),
    ),
  ),
})

export function parseAzureThreads(context: ForgeContext, stdout: string) {
  const page = parseForgeJson(
    context,
    v.object({ value: v.array(threadSchema) }),
    stdout,
    'discussion-threads',
  )
  const comments: GitPullRequestComment[] = []
  let count = 0
  for (const thread of page.value) {
    if (thread.isDeleted) continue
    for (const comment of thread.comments ?? []) {
      if (!visible(comment)) continue
      count += 1
      if (comments.length === 100) continue
      comments.push({
        id: `${thread.id}:${comment.id}`,
        body: comment.content ?? '',
        author: comment.author?.displayName?.trim() || 'Deleted account',
        createdAt: comment.publishedDate ?? '',
        url: null,
        context: {
          threadId: String(thread.id),
          path: thread.threadContext?.filePath?.trim() || null,
        },
      })
    }
  }
  // Azure returns the whole collection; a full preview alone does not prove truncation.
  return { comments, truncated: count > 100 }
}

function visible(comment: NonNullable<v.InferOutput<typeof threadSchema>['comments']>[number]) {
  return (
    comment.id != null &&
    !comment.isDeleted &&
    comment.commentType?.trim().toLowerCase() !== 'system' &&
    Boolean(comment.content?.trim()) &&
    Boolean(comment.publishedDate?.trim())
  )
}
