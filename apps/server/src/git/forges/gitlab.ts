import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import {
  cliSupport,
  forgeCommand,
  requireCreated,
  parseForgeJson,
  perBranch,
  requireSuccess,
} from './cli'
import type { ForgeContext, ForgeProvider } from './types'

const mergeRequestSchema = v.object({
  iid: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  web_url: v.pipe(v.string(), v.url()),
  state: v.string(),
  draft: v.optional(v.boolean()),
  work_in_progress: v.optional(v.boolean()),
  closed_at: v.optional(v.nullable(v.string())),
  merged_at: v.optional(v.nullable(v.string())),
})

/** `glab`, which picks the GitLab host from the checkout's remote on its own. */
export const gitlab: ForgeProvider = {
  kind: 'gitlab',
  async support(context) {
    return cliSupport(await glab(context, ['auth', 'status', '--hostname', context.forge.host]))
  },
  pullRequests(context, { branches, state }) {
    return perBranch(branches, (branch) => newestMergeRequest(context, branch, state))
  },
  async createPullRequest(context, input) {
    const result = await glab(context, [
      'mr',
      'create',
      '--source-branch',
      input.branch,
      '--title',
      input.title,
      '--description',
      input.body,
      '--yes',
      ...(input.base ? ['--target-branch', input.base] : []),
      ...(input.draft ? ['--draft'] : []),
    ])
    requireCreated(context, input.branch, result)
  },
}

async function newestMergeRequest(context: ForgeContext, branch: string, state: 'open' | 'all') {
  const result = requireSuccess(
    context,
    await glab(context, [
      'mr',
      'list',
      '--source-branch',
      branch,
      ...(state === 'all' ? ['--all'] : []),
      '--per-page',
      '1',
      '--output',
      'json',
    ]),
    'mr-list',
  )
  const [request] = parseForgeJson(context, v.array(mergeRequestSchema), result.stdout, 'mr-list')
  return request ? toPullRequest(request) : null
}

function glab(context: ForgeContext, args: readonly string[]) {
  return forgeCommand(context, ['glab', ...args])
}

function toPullRequest(request: v.InferOutput<typeof mergeRequestSchema>): GitPullRequest {
  return {
    closedAt: request.merged_at ?? request.closed_at ?? null,
    draft: Boolean(request.draft ?? request.work_in_progress),
    number: request.iid,
    state: mergeRequestState(request.state),
    title: request.title,
    url: request.web_url,
  }
}

function mergeRequestState(state: string): GitPullRequest['state'] {
  const normalized = state.toLowerCase()
  if (normalized === 'merged' || normalized === 'closed') return normalized
  return 'open'
}
