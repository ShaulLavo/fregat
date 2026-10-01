import * as v from 'valibot'
import { parseForgeJson } from './cli'
import type { ForgeContext } from './types'

const commentsSchema = v.array(
  v.object({
    id: v.number(),
    body: v.string(),
    created_at: v.string(),
    html_url: v.pipe(v.string(), v.url()),
    user: v.nullable(v.object({ login: v.string() })),
  }),
)

/** GitHub and Forgejo expose the same issue-comment payload. */
export function parseIssueComments(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(context, commentsSchema, stdout, 'comments')
  return {
    comments: rows.map((row) => ({
      id: String(row.id),
      body: row.body,
      author: row.user?.login ?? 'Deleted account',
      createdAt: row.created_at,
      url: row.html_url,
    })),
    truncated: rows.length === 100,
  }
}
