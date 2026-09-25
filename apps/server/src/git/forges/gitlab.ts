import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import {
  cliSupport,
  forgeCommand,
  requireCreated,
  requireRepositoryCreated,
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

const projectSchema = v.object({
  web_url: v.string(),
  http_url_to_repo: v.string(),
  ssh_url_to_repo: v.string(),
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
  async createRepository(context, visibility) {
    const parts = (context.repository ?? '').split('/').filter(Boolean)
    const name = parts.at(-1) ?? ''
    const namespace = parts.slice(0, -1).join('/')
    const namespaceId = namespace ? await namespaceIdOf(context, namespace) : null
    const result = requireRepositoryCreated(
      context,
      await glab(context, [
        'api',
        '--method',
        'POST',
        'projects',
        '--raw-field',
        `path=${name}`,
        '--raw-field',
        `name=${name}`,
        '--raw-field',
        `visibility=${visibility}`,
        ...(namespaceId === null ? [] : ['--raw-field', `namespace_id=${namespaceId}`]),
      ]),
    )
    const project = parseForgeJson(context, projectSchema, result.stdout, 'create-project')
    return {
      url: project.web_url,
      httpsUrl: project.http_url_to_repo,
      sshUrl: project.ssh_url_to_repo,
    }
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

async function namespaceIdOf(context: ForgeContext, namespace: string) {
  const result = requireRepositoryCreated(
    context,
    await glab(context, ['api', `namespaces/${encodeURIComponent(namespace)}`]),
  )
  return parseForgeJson(context, v.object({ id: v.number() }), result.stdout, 'namespace').id
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
