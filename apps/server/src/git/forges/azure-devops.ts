import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import {
  cliSupport,
  forgeCommand,
  repositoryParts,
  requireCreated,
  requireRepositoryCreated,
  parseForgeJson,
  perBranch,
  requireSuccess,
} from './cli'
import type { ForgeContext, ForgeProvider } from './types'

const JSON_ARGS = ['--only-show-errors', '--output', 'json'] as const

const pullRequestSchema = v.object({
  pullRequestId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  status: v.string(),
  isDraft: v.optional(v.boolean()),
  closedDate: v.optional(v.nullable(v.string())),
  repository: v.object({ webUrl: v.pipe(v.string(), v.url()) }),
})

/**
 * `az repos` from the azure-devops extension. `--detect true` takes the organization and project
 * from the checkout, as upstream does.
 */
export const azureDevOps: ForgeProvider = {
  kind: 'azure-devops',
  async support(context) {
    return cliSupport(
      await az(context, ['account', 'show', '--query', 'user.name', '--output', 'tsv']),
    )
  },
  pullRequests(context, { branches, state }) {
    return perBranch(branches, (branch) => newestPullRequest(context, branch, state))
  },
  async createPullRequest(context, input) {
    const result = await az(context, [
      'repos',
      'pr',
      'create',
      '--detect',
      'true',
      '--source-branch',
      input.branch,
      '--title',
      input.title,
      '--description',
      input.body,
      ...(input.base ? ['--target-branch', input.base] : []),
      ...(input.draft ? ['--draft', 'true'] : []),
      ...JSON_ARGS,
    ])
    requireCreated(context, input.branch, result)
  },
  async getPullRequest(context, number) {
    const result = requireSuccess(
      context,
      await az(context, [
        'repos',
        'pr',
        'show',
        '--detect',
        'true',
        '--id',
        String(number),
        ...JSON_ARGS,
      ]),
      'pr-show',
    )
    const detail = parseForgeJson(
      context,
      v.object({
        ...pullRequestSchema.entries,
        sourceRefName: v.string(),
        targetRefName: v.string(),
        forkSource: v.optional(
          v.nullable(
            v.object({
              name: v.string(),
              objectId: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/i)),
              repository: v.object({ remoteUrl: v.pipe(v.string(), v.url()) }),
            }),
          ),
        ),
      }),
      result.stdout,
      'pr-show',
    )
    const head = detail.sourceRefName.replace(/^refs\/heads\//, '')
    return {
      ...toPullRequest(detail),
      headRefName: head,
      baseRefName: detail.targetRefName.replace(/^refs\/heads\//, ''),
      crossRepository: detail.forkSource != null,
      headFetchRef: detail.forkSource?.name ?? `refs/heads/${head}`,
      ...(detail.forkSource
        ? {
            headSource: {
              url: detail.forkSource.repository.remoteUrl,
              commit: detail.forkSource.objectId,
            },
          }
        : {}),
    }
  },
  // Azure has no visibility per repository; the project's decides, as upstream notes.
  async createRepository(context) {
    const [organization, project, name] = repositoryParts(context, 3, 'organization/project/name')
    const result = requireRepositoryCreated(
      context,
      await az(context, [
        'repos',
        'create',
        '--org',
        `https://dev.azure.com/${organization}`,
        '--project',
        project ?? '',
        '--name',
        name ?? '',
        ...JSON_ARGS,
      ]),
    )
    const repository = parseForgeJson(
      context,
      v.object({ webUrl: v.string(), remoteUrl: v.string(), sshUrl: v.string() }),
      result.stdout,
      'create-repository',
    )
    return { url: repository.webUrl, httpsUrl: repository.remoteUrl, sshUrl: repository.sshUrl }
  },
}

async function newestPullRequest(context: ForgeContext, branch: string, state: 'open' | 'all') {
  const result = requireSuccess(
    context,
    await az(context, [
      'repos',
      'pr',
      'list',
      '--detect',
      'true',
      '--source-branch',
      branch,
      '--status',
      state === 'open' ? 'active' : 'all',
      '--top',
      '1',
      ...JSON_ARGS,
    ]),
    'pr-list',
  )
  const [request] = parseForgeJson(context, v.array(pullRequestSchema), result.stdout, 'pr-list')
  return request ? toPullRequest(request) : null
}

function az(context: ForgeContext, args: readonly string[]) {
  return forgeCommand(context, ['az', ...args])
}

function toPullRequest(request: v.InferOutput<typeof pullRequestSchema>): GitPullRequest {
  return {
    closedAt: request.closedDate ?? null,
    draft: request.isDraft === true,
    number: request.pullRequestId,
    state: pullRequestState(request.status),
    title: request.title,
    url: `${request.repository.webUrl}/pullrequest/${request.pullRequestId}`,
  }
}

function pullRequestState(status: string): GitPullRequest['state'] {
  if (status === 'completed') return 'merged'
  if (status === 'abandoned') return 'closed'
  return 'open'
}
