import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import { gitPullRequestErrors } from '../utils/pull-request-errors'
import { forgeCommand, parseForgeJson, perBranch, repositoryParts } from './cli'
import type { ForgeContext, ForgeProvider } from './types'

const API_BASE = 'https://api.bitbucket.org/2.0'
const OPEN_STATES = ['OPEN']
const ALL_STATES = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']

const pullRequestSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  state: v.string(),
  draft: v.optional(v.boolean()),
  updated_on: v.optional(v.string()),
  links: v.object({ html: v.object({ href: v.pipe(v.string(), v.url()) }) }),
})

/**
 * Bitbucket Cloud's REST API. It authenticates with the credentials git already keeps for
 * bitbucket.org (an app password or API token behind the credential helper), so no token is
 * stored here; upstream reads environment variables instead.
 */
export const bitbucket: ForgeProvider = {
  kind: 'bitbucket',
  async support(context) {
    return (await credentials(context)) ? 'ready' : 'unauthenticated'
  },
  async pullRequests(context, { branches, state }) {
    const authorization = await requireCredentials(context)
    return perBranch(branches, (branch) => newestPullRequest(context, authorization, branch, state))
  },
  async createPullRequest(context, input) {
    const authorization = await requireCredentials(context)
    const response = await request(context, authorization, 'pullrequests', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        description: input.body,
        source: { branch: { name: input.branch } },
        ...(input.base ? { destination: { branch: { name: input.base } } } : {}),
        ...(input.draft ? { draft: true } : {}),
      }),
    })
    if (!response.ok)
      throw gitPullRequestErrors.PULL_REQUEST_CREATE_FAILED({
        branch: input.branch,
        forge: context.forge.name,
        internal: { status: response.status },
      })
  },
  async getPullRequest(context, number) {
    const authorization = await requireCredentials(context)
    const response = await request(context, authorization, `pullrequests/${number}`)
    if (!response.ok)
      throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
        forge: context.forge.name,
        internal: { at: 'pullrequest', status: response.status },
      })
    const side = v.object({
      branch: v.object({ name: v.string() }),
      repository: v.object({ full_name: v.string() }),
    })
    const detail = parseForgeJson(
      context,
      v.object({ ...pullRequestSchema.entries, source: side, destination: side }),
      await response.text(),
      'pullrequest',
    )
    return {
      ...toPullRequest(detail),
      headRefName: detail.source.branch.name,
      baseRefName: detail.destination.branch.name,
      crossRepository:
        detail.source.repository.full_name !== detail.destination.repository.full_name,
      headFetchRef: `refs/heads/${detail.source.branch.name}`,
    }
  },
  async createRepository(context, visibility) {
    repositoryParts(context, 2, 'workspace/name')
    const authorization = await requireCredentials(context)
    const response = await request(context, authorization, '', {
      method: 'POST',
      body: JSON.stringify({ scm: 'git', is_private: visibility === 'private' }),
    })
    if (!response.ok)
      throw gitPullRequestErrors.REPOSITORY_CREATE_FAILED({
        forge: context.forge.name,
        repository: context.repository ?? '',
        internal: { status: response.status },
      })
    const repository = parseForgeJson(
      context,
      v.object({
        links: v.object({
          html: v.object({ href: v.string() }),
          clone: v.array(v.object({ name: v.string(), href: v.string() })),
        }),
      }),
      await response.text(),
      'create-repository',
    )
    const clone = (name: string) =>
      repository.links.clone.find((link) => link.name === name)?.href ?? ''
    return { url: repository.links.html.href, httpsUrl: clone('https'), sshUrl: clone('ssh') }
  },
}

async function newestPullRequest(
  context: ForgeContext,
  authorization: string,
  branch: string,
  state: 'open' | 'all',
) {
  const params = new URLSearchParams({
    q: `source.branch.name = "${branch.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    pagelen: '1',
    sort: '-updated_on',
  })
  for (const value of state === 'open' ? OPEN_STATES : ALL_STATES) params.append('state', value)
  const response = await request(context, authorization, `pullrequests?${params}`)
  if (!response.ok)
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      forge: context.forge.name,
      internal: {
        at: 'pullrequests',
        status: response.status,
        rateLimited: response.status === 429,
      },
    })
  const page = parseForgeJson(
    context,
    v.object({ values: v.array(pullRequestSchema) }),
    await response.text(),
    'pullrequests',
  )
  const [pullRequest] = page.values
  return pullRequest ? toPullRequest(pullRequest) : null
}

async function request(
  context: ForgeContext,
  authorization: string,
  path: string,
  init: { method?: string; body?: string } = {},
) {
  try {
    return await context.fetch(repositoryUrl(context, path), {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        authorization,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (cause) {
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      forge: context.forge.name,
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: 'fetch', path: path.split('?')[0] },
    })
  }
}

/** Basic auth from `git credential fill`, never prompting; null when git holds nothing. */
async function credentials(context: ForgeContext) {
  const result = await forgeCommand(
    context,
    ['git', '-c', 'credential.interactive=false', 'credential', 'fill'],
    {
      env: { GIT_TERMINAL_PROMPT: '0' },
      input: `protocol=https\nhost=${context.forge.host}\n\n`,
    },
  )
  if (result.exitCode !== 0) return null
  const fields = new Map(
    result.stdout
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  const username = fields.get('username')
  const password = fields.get('password')
  if (!username || !password) return null
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function requireCredentials(context: ForgeContext) {
  const authorization = await credentials(context)
  if (authorization) return authorization
  throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
    forge: context.forge.name,
    internal: { at: 'credentials', reason: 'none-stored' },
  })
}

function toPullRequest(pullRequest: v.InferOutput<typeof pullRequestSchema>): GitPullRequest {
  const state = pullRequestState(pullRequest.state)
  return {
    closedAt: state === 'open' ? null : (pullRequest.updated_on ?? null),
    draft: pullRequest.draft === true,
    number: pullRequest.id,
    state,
    title: pullRequest.title,
    url: pullRequest.links.html.href,
  }
}

function pullRequestState(state: string): GitPullRequest['state'] {
  if (state === 'MERGED') return 'merged'
  if (state === 'DECLINED' || state === 'SUPERSEDED') return 'closed'
  return 'open'
}

function repositoryUrl(context: ForgeContext, path: string) {
  const base = `${API_BASE}/repositories/${context.repository ?? ''}`
  return path ? `${base}/${path}` : base
}
