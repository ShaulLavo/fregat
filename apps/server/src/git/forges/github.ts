import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import { gitPullRequestErrors } from '../utils/pull-request-errors'
import {
  cliSupport,
  forgeCommand,
  parseForgeJson,
  repositoryParts,
  requireCreated,
  requireRepositoryCreated,
  requireSuccess,
} from './cli'
import type { ForgeContext, ForgeProvider } from './types'

const PR_FIELDS = 'isDraft,number,state,title,url,closedAt'

/** Aliased connections per GraphQL request; a repository with more branches takes several. */
const BRANCHES_PER_QUERY = 50

const pullRequestSchema = v.object({
  isDraft: v.boolean(),
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  url: v.pipe(v.string(), v.url()),
  state: v.picklist(['OPEN', 'CLOSED', 'MERGED']),
  closedAt: v.optional(v.nullable(v.string())),
})

const graphqlSchema = v.object({
  data: v.object({
    repository: v.record(v.string(), v.object({ nodes: v.array(pullRequestSchema) })),
  }),
})

const GITHUB_STATES = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const

/** `gh`. A self-hosted host is named on every call so `gh` never falls back to github.com. */
export const github: ForgeProvider = {
  kind: 'github',
  async support(context) {
    return cliSupport(await gh(context, ['auth', 'status', ...hostname(context)]))
  },
  async pullRequests(context, { branches, state }) {
    // One open branch is the header's question; `pr list` answers it without a repository name.
    const [only] = branches
    if (state === 'open' && branches.length === 1 && only !== undefined)
      return new Map([[only, await openPullRequest(context, only)]])
    return graphqlPullRequests(context, branches, state)
  },
  async createPullRequest(context, input) {
    const result = await gh(context, [
      'pr',
      'create',
      '--head',
      input.branch,
      '--title',
      input.title,
      '--body',
      input.body,
      ...(input.base ? ['--base', input.base] : []),
      ...(input.draft ? ['--draft'] : []),
    ])
    requireCreated(context, input.branch, result)
  },
  async getPullRequest(context, number) {
    const result = requireSuccess(
      context,
      await gh(context, [
        'pr',
        'view',
        String(number),
        '--repo',
        context.remoteUrl,
        '--json',
        `${PR_FIELDS},headRefName,baseRefName,isCrossRepository`,
      ]),
      'pr-view',
    )
    const detail = parseForgeJson(
      context,
      v.object({
        ...pullRequestSchema.entries,
        headRefName: v.string(),
        baseRefName: v.string(),
        isCrossRepository: v.boolean(),
      }),
      result.stdout,
      'pr-view',
    )
    return {
      ...toPullRequest(detail),
      headRefName: detail.headRefName,
      baseRefName: detail.baseRefName,
      crossRepository: detail.isCrossRepository,
      headFetchRef: `refs/pull/${number}/head`,
    }
  },
  async createRepository(context, visibility) {
    const [owner, name] = repositoryParts(context, 2, 'owner/name')
    requireRepositoryCreated(
      context,
      await gh(context, ['repo', 'create', `${owner}/${name}`, `--${visibility}`]),
    )
    const origin = `https://${context.forge.host}`
    return {
      url: `${origin}/${owner}/${name}`,
      httpsUrl: `${origin}/${owner}/${name}.git`,
      sshUrl: `git@${context.forge.host}:${owner}/${name}.git`,
    }
  },
}

async function openPullRequest(context: ForgeContext, branch: string) {
  const result = requireSuccess(
    context,
    await gh(context, [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      PR_FIELDS,
    ]),
    'pr-list',
  )
  const [pullRequest] = parseForgeJson(
    context,
    v.array(pullRequestSchema),
    result.stdout,
    'pr-list',
  )
  return pullRequest ? toPullRequest(pullRequest) : null
}

async function graphqlPullRequests(
  context: ForgeContext,
  branches: readonly string[],
  state: 'open' | 'all',
) {
  const repository = ownerAndName(context)
  const pullRequests = new Map<string, GitPullRequest | null>()
  const unique = [...new Set(branches)]
  for (let start = 0; start < unique.length; start += BRANCHES_PER_QUERY) {
    const chunk = unique.slice(start, start + BRANCHES_PER_QUERY)
    const found = await graphqlChunk(context, repository, chunk, state)
    chunk.forEach((branch, index) => pullRequests.set(branch, found[index] ?? null))
  }
  return pullRequests
}

async function graphqlChunk(
  context: ForgeContext,
  repository: { owner: string; name: string },
  branches: readonly string[],
  state: 'open' | 'all',
) {
  const states = state === 'open' ? '[OPEN]' : '[OPEN, CLOSED, MERGED]'
  // Branch names travel as variables, never inside the query text.
  const variables = branches.map((_, index) => `$h${index}: String!`).join(', ')
  const fields = branches
    .map(
      (_, index) =>
        `b${index}: pullRequests(headRefName: $h${index}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}, states: ${states}) { nodes { number title url state isDraft closedAt } }`,
    )
    .join(' ')
  const query = `query($owner: String!, $name: String!, ${variables}) { repository(owner: $owner, name: $name) { ${fields} } }`
  const result = requireSuccess(
    context,
    await gh(context, [
      'api',
      'graphql',
      ...hostname(context),
      '-f',
      `query=${query}`,
      '-f',
      `owner=${repository.owner}`,
      '-f',
      `name=${repository.name}`,
      ...branches.flatMap((branch, index) => ['-f', `h${index}=${branch}`]),
    ]),
    'graphql',
  )
  const parsed = parseForgeJson(context, graphqlSchema, result.stdout, 'graphql')
  return branches.map((_, index) => {
    const node = parsed.data.repository[`b${index}`]?.nodes[0]
    return node ? toPullRequest(node) : null
  })
}

function ownerAndName(context: ForgeContext) {
  const [owner, name, ...rest] = (context.repository ?? '').split('/')
  if (owner && name && rest.length === 0) return { owner, name }
  throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
    forge: context.forge.name,
    internal: { at: 'repository-name', segments: (context.repository ?? '').split('/').length },
  })
}

function gh(context: ForgeContext, args: readonly string[]) {
  const env = context.forge.host === 'github.com' ? undefined : { GH_HOST: context.forge.host }
  return forgeCommand(context, ['gh', ...args], env ? { env } : {})
}

function hostname(context: ForgeContext) {
  return context.forge.host === 'github.com' ? [] : ['--hostname', context.forge.host]
}

function toPullRequest(node: v.InferOutput<typeof pullRequestSchema>): GitPullRequest {
  return {
    closedAt: node.closedAt ?? null,
    draft: node.isDraft,
    number: node.number,
    state: GITHUB_STATES[node.state],
    title: node.title,
    url: node.url,
  }
}
