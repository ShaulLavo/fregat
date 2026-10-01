import type {
  GitPullRequestActivitySection,
  GitPullRequestComment,
  GitPullRequestCommit,
  GitPullRequestReviewRecord,
  GitPullRequestThread,
} from '@workspace/contracts'
import * as v from 'valibot'
import { parseForgeJson } from './cli'
import type { ForgeContext } from './types'

const actor = v.nullable(v.object({ login: v.string() }))
const id = v.pipe(v.number(), v.integer(), v.minValue(1))
const timestamp = v.pipe(v.string(), v.isoTimestamp())
const sha = v.pipe(v.string(), v.regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i))

function activityPage<T>(
  items: readonly T[],
  truncated: boolean,
): GitPullRequestActivitySection<T> {
  return { kind: 'ready', items: items.slice(0, 100), truncated: truncated || items.length > 100 }
}

export function groupActivityThreads(
  comments: readonly GitPullRequestComment[],
  truncated: boolean,
) {
  const groups = new Map<string, GitPullRequestThread>()
  for (const comment of comments) {
    if (!comment.context) continue
    const key = comment.context.threadId
    const group = groups.get(key)
    groups.set(key, {
      id: key,
      path: group?.path ?? comment.context.path,
      comments: [...(group?.comments ?? []), comment],
    })
  }
  return activityPage([...groups.values()], truncated)
}

export function parseGithubReviews(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        id,
        body: v.nullable(v.string()),
        user: actor,
        state: v.string(),
        submitted_at: v.optional(v.nullable(timestamp)),
      }),
    ),
    stdout,
    'activity-reviews',
  )
  const items: GitPullRequestReviewRecord[] = rows
    .slice(0, 100)
    .filter((row) => row.state !== 'PENDING' && row.submitted_at)
    .map((row) => ({
      id: String(row.id),
      body: row.body ?? '',
      author: row.user?.login ?? 'Deleted account',
      state: row.state,
      createdAt: row.submitted_at!,
    }))
  return activityPage(items, rows.length >= 100)
}

export function parseRestCommits(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        sha,
        author: actor,
        commit: v.object({ message: v.string(), committer: v.object({ date: timestamp }) }),
      }),
    ),
    stdout,
    'activity-commits',
  )
  const items: GitPullRequestCommit[] = rows.map((row) => ({
    oid: row.sha,
    message: row.commit.message,
    author: row.author?.login ?? 'Unknown author',
    createdAt: row.commit.committer.date,
  }))
  return activityPage(items, rows.length >= 100)
}

export function parseGithubThreads(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        id,
        body: v.string(),
        user: actor,
        created_at: timestamp,
        path: v.string(),
        in_reply_to_id: v.optional(id),
        html_url: v.pipe(v.string(), v.url()),
      }),
    ),
    stdout,
    'activity-threads',
  )
  const comments: GitPullRequestComment[] = rows.slice(0, 100).map((row) => ({
    id: String(row.id),
    body: row.body,
    author: row.user?.login ?? 'Deleted account',
    createdAt: row.created_at,
    url: row.html_url,
    context: { threadId: String(row.in_reply_to_id ?? row.id), path: row.path },
  }))
  return groupActivityThreads(comments, rows.length >= 100)
}

export function parseGitlabCommits(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        id: sha,
        message: v.string(),
        author_name: v.string(),
        committed_date: timestamp,
      }),
    ),
    stdout,
    'activity-commits',
  )
  return activityPage(
    rows.map((row) => ({
      oid: row.id,
      message: row.message,
      author: row.author_name,
      createdAt: row.committed_date,
    })),
    rows.length >= 100,
  )
}

export function parseGitlabThreads(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        id: v.pipe(v.string(), v.minLength(1)),
        individual_note: v.boolean(),
        notes: v.array(
          v.object({
            id,
            body: v.string(),
            created_at: timestamp,
            system: v.boolean(),
            author: v.object({ username: v.string() }),
            position: v.optional(
              v.nullable(
                v.object({
                  new_path: v.optional(v.nullable(v.string())),
                  old_path: v.optional(v.nullable(v.string())),
                }),
              ),
            ),
          }),
        ),
      }),
    ),
    stdout,
    'activity-threads',
  )
  const threads: GitPullRequestThread[] = rows
    .slice(0, 100)
    .filter((row) => !row.individual_note)
    .map((row) => {
      const notes = row.notes.filter((note) => !note.system)
      const position = notes.find((note) => note.position)?.position
      const path = position?.new_path ?? position?.old_path ?? null
      return {
        id: row.id,
        path,
        comments: notes.slice(0, 100).map((note) => ({
          id: String(note.id),
          body: note.body,
          author: note.author.username,
          createdAt: note.created_at,
          url: null,
          context: { threadId: row.id, path },
        })),
      }
    })
    .filter((thread) => thread.comments.length > 0)
  return activityPage(threads, rows.length >= 100 || rows.some((row) => row.notes.length > 100))
}

const forgejoReviewsSchema = v.array(
  v.object({
    id,
    body: v.string(),
    user: actor,
    state: v.string(),
    submitted_at: timestamp,
    comments_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
)

export function parseForgejoReviews(context: ForgeContext, stdout: string) {
  const rows = parseForgeJson(context, forgejoReviewsSchema, stdout, 'activity-reviews')
  const visible = rows.filter((row) => row.state !== 'PENDING' && row.state !== 'REQUEST_REVIEW')
  return {
    reviews: activityPage(
      visible.map((row) => ({
        id: String(row.id),
        body: row.body,
        author: row.user?.login ?? 'Deleted account',
        state: row.state,
        createdAt: row.submitted_at,
      })),
      rows.length >= 100,
    ),
    inlineReviewIds: visible
      .filter((row) => row.comments_count > 0)
      .slice(0, 20)
      .map((row) => row.id),
    inlineTruncated:
      rows.length >= 100 || visible.filter((row) => row.comments_count > 0).length > 20,
  }
}

export function parseForgejoInline(
  context: ForgeContext,
  stdout: string,
): readonly GitPullRequestComment[] {
  const rows = parseForgeJson(
    context,
    v.array(
      v.object({
        id,
        body: v.string(),
        user: actor,
        created_at: timestamp,
        path: v.string(),
        html_url: v.optional(v.pipe(v.string(), v.url())),
      }),
    ),
    stdout,
    'activity-threads',
  )
  return rows.map((row) => ({
    id: String(row.id),
    body: row.body,
    author: row.user?.login ?? 'Deleted account',
    createdAt: row.created_at,
    url: row.html_url ?? null,
    context: { threadId: String(row.id), path: row.path },
  }))
}

export function parseBitbucketReviews(context: ForgeContext, stdout: string) {
  const pull = parseForgeJson(
    context,
    v.object({
      id,
      participants: v.optional(
        v.nullable(
          v.array(
            v.object({
              user: v.optional(
                v.nullable(v.object({ uuid: v.string(), display_name: v.string() })),
              ),
              state: v.optional(v.nullable(v.string())),
              approved: v.optional(v.boolean()),
              participated_on: v.optional(v.nullable(timestamp)),
            }),
          ),
        ),
      ),
    }),
    stdout,
    'activity-reviews',
  )
  const items: GitPullRequestReviewRecord[] = []
  for (const row of pull.participants ?? []) {
    const state = row.state ?? (row.approved ? 'approved' : null)
    if (!row.user || !row.participated_on || !state) continue
    items.push({
      id: `${pull.id}:${row.user.uuid}`,
      author: row.user.display_name,
      body: '',
      state,
      createdAt: row.participated_on,
    })
  }
  return activityPage(items, false)
}

export function parseBitbucketCommits(context: ForgeContext, stdout: string) {
  const page = parseForgeJson(
    context,
    v.object({
      next: v.optional(v.string()),
      values: v.array(
        v.object({
          hash: sha,
          message: v.string(),
          date: timestamp,
          author: v.object({ raw: v.string() }),
        }),
      ),
    }),
    stdout,
    'activity-commits',
  )
  return activityPage(
    page.values.map((row) => ({
      oid: row.hash,
      message: row.message,
      author: row.author.raw,
      createdAt: row.date,
    })),
    Boolean(page.next),
  )
}

export const bitbucketCommentFields = {
  content: v.object({ raw: v.string() }),
  user: v.nullable(v.object({ display_name: v.string() })),
  links: v.object({ html: v.object({ href: v.pipe(v.string(), v.url()) }) }),
}

export function parseBitbucketThreads(context: ForgeContext, stdout: string) {
  const page = parseForgeJson(
    context,
    v.object({
      next: v.optional(v.string()),
      values: v.array(
        v.object({
          id,
          deleted: v.optional(v.boolean()),
          created_on: timestamp,
          parent: v.optional(v.nullable(v.object({ id }))),
          inline: v.optional(v.nullable(v.object({ path: v.string() }))),
          ...bitbucketCommentFields,
        }),
      ),
    }),
    stdout,
    'activity-threads',
  )
  const rows = page.values.slice(0, 100)
  const parents = new Map(rows.map((row) => [row.id, row.parent?.id]))
  const byId = new Map(rows.map((row) => [row.id, row]))
  const comments: GitPullRequestComment[] = rows
    .filter((row) => !row.deleted)
    .map((row) => {
      const root = activityRootId(row.id, parents)
      return {
        id: String(row.id),
        author: row.user?.display_name ?? 'Deleted account',
        body: row.content.raw,
        createdAt: row.created_on,
        url: row.links.html.href,
        context: {
          threadId: String(root),
          path: byId.get(root)?.inline?.path ?? row.inline?.path ?? null,
        },
      }
    })
  return groupActivityThreads(comments, Boolean(page.next) || page.values.length > 100)
}

function activityRootId(id: number, parents: ReadonlyMap<number, number | undefined>) {
  let current = id
  // Native parent walks are bounded even when a host returns a cycle.
  for (let step = 0; step < parents.size; step += 1) {
    const parent = parents.get(current)
    if (parent === undefined) return current
    current = parent
  }
  return current
}
