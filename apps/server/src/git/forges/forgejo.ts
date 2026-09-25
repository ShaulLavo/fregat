import type { GitPullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import { gitPullRequestErrors } from '../utils/pull-request-errors'
import {
  forgeCommand,
  parseForgeJson,
  repositoryParts,
  requireCreated,
  requireRepositoryCreated,
  requireSuccess,
} from './cli'
import type { ForgeContext, ForgeProvider } from './types'

/** Recently updated pull requests read per lookup; the branch filter runs on them. */
const PAGE_SIZE = 50

const loginSchema = v.array(v.object({ name: v.string(), url: v.string() }))

const pullSchema = v.object({
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  html_url: v.pipe(v.string(), v.url()),
  state: v.string(),
  merged: v.optional(v.boolean()),
  draft: v.optional(v.boolean()),
  closed_at: v.optional(v.nullable(v.string())),
  merged_at: v.optional(v.nullable(v.string())),
  head: v.object({ ref: v.string() }),
})

/**
 * Forgejo and Gitea through `tea`: its signed-in login for this host carries the token, and
 * `tea api` calls the REST API with it. Upstream prefers `fj` when it has a login; `tea` is its
 * fallback and the one wired here.
 */
export const forgejo: ForgeProvider = {
  kind: 'forgejo',
  async support(context) {
    const result = await forgeCommand(context, ['tea', 'login', 'list', '--output', 'json'])
    if (result.exitCode !== 0 && !result.stderr && !result.stdout) return 'cli-missing'
    if (result.exitCode !== 0) return 'unauthenticated'
    return (await teaLogin(context)) ? 'ready' : 'unauthenticated'
  },
  async pullRequests(context, { branches, state }) {
    const login = await requireLogin(context)
    const query = `state=${state === 'open' ? 'open' : 'all'}&sort=recentupdate&limit=${PAGE_SIZE}`
    const result = requireSuccess(
      context,
      await tea(context, ['api', '--login', login.name, apiUrl(login, context, `pulls?${query}`)]),
      'pulls',
    )
    const pulls = parseForgeJson(context, v.array(pullSchema), result.stdout, 'pulls')
    // Newest first, so the first match per branch is its latest pull request.
    return new Map(
      [...new Set(branches)].map((branch) => {
        const pull = pulls.find((entry) => entry.head.ref === branch)
        return [branch, pull ? toPullRequest(pull) : null] as const
      }),
    )
  },
  async createPullRequest(context, input) {
    const login = await requireLogin(context)
    const base = input.base ?? (await defaultBranch(context, login))
    const result = await tea(
      context,
      [
        'api',
        '--login',
        login.name,
        '--method',
        'POST',
        '--data',
        '@-',
        apiUrl(login, context, 'pulls'),
      ],
      JSON.stringify({ base, head: input.branch, title: input.title, body: input.body }),
    )
    requireCreated(context, input.branch, result)
  },
  async getPullRequest(context, number) {
    const login = await requireLogin(context)
    const result = requireSuccess(
      context,
      await tea(context, ['api', '--login', login.name, apiUrl(login, context, `pulls/${number}`)]),
      'pull',
    )
    const repo = v.object({ full_name: v.string() })
    const pull = parseForgeJson(
      context,
      v.object({
        ...pullSchema.entries,
        head: v.object({ ref: v.string(), repo: v.nullable(repo) }),
        base: v.object({ ref: v.string(), repo: v.nullable(repo) }),
      }),
      result.stdout,
      'pull',
    )
    return {
      ...toPullRequest(pull),
      headRefName: pull.head.ref,
      baseRefName: pull.base.ref,
      crossRepository: pull.head.repo?.full_name !== pull.base.repo?.full_name,
      headFetchRef: `refs/pull/${number}/head`,
    }
  },
  async createRepository(context, visibility) {
    const [owner, name] = repositoryParts(context, 2, 'owner/name')
    const login = await requireLogin(context)
    const base = `${login.url.replace(/\/+$/, '')}/api/v1`
    const user = parseForgeJson(
      context,
      v.object({ login: v.string() }),
      requireSuccess(
        context,
        await tea(context, ['api', '--login', login.name, `${base}/user`]),
        'user',
      ).stdout,
      'user',
    )
    const target = user.login === owner ? `${base}/user/repos` : `${base}/orgs/${owner}/repos`
    const result = requireRepositoryCreated(
      context,
      await tea(
        context,
        ['api', '--login', login.name, '--method', 'POST', '--data', '@-', target],
        JSON.stringify({ name, private: visibility === 'private', auto_init: false }),
      ),
    )
    const repository = parseForgeJson(
      context,
      v.object({ html_url: v.string(), clone_url: v.string(), ssh_url: v.string() }),
      result.stdout,
      'create-repository',
    )
    return { url: repository.html_url, httpsUrl: repository.clone_url, sshUrl: repository.ssh_url }
  },
}

async function defaultBranch(context: ForgeContext, login: { name: string; url: string }) {
  const result = requireSuccess(
    context,
    await tea(context, ['api', '--login', login.name, apiUrl(login, context, '')]),
    'repository',
  )
  const repository = parseForgeJson(
    context,
    v.object({ default_branch: v.string() }),
    result.stdout,
    'repository',
  )
  return repository.default_branch
}

/** The `tea` login whose URL has this remote's host. */
async function teaLogin(context: ForgeContext) {
  const result = await forgeCommand(context, ['tea', 'login', 'list', '--output', 'json'])
  if (result.exitCode !== 0) return null
  const logins = parseForgeJson(context, loginSchema, result.stdout, 'login-list')
  return logins.find((login) => hostOf(login.url) === context.forge.host) ?? null
}

async function requireLogin(context: ForgeContext) {
  const login = await teaLogin(context)
  if (login) return login
  throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
    forge: context.forge.name,
    internal: { at: 'tea-login', reason: 'no-login-for-host' },
  })
}

function apiUrl(login: { url: string }, context: ForgeContext, path: string) {
  const suffix = path ? `/${path}` : ''
  return `${login.url.replace(/\/+$/, '')}/api/v1/repos/${context.repository ?? ''}${suffix}`
}

function tea(context: ForgeContext, args: readonly string[], input?: string) {
  return forgeCommand(context, ['tea', ...args], input === undefined ? {} : { input })
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function toPullRequest(pull: v.InferOutput<typeof pullSchema>): GitPullRequest {
  return {
    closedAt: pull.merged_at ?? pull.closed_at ?? null,
    draft: pull.draft ?? /^(?:\[WIP\]|WIP:)/i.test(pull.title),
    number: pull.number,
    state: pullState(pull),
    title: pull.title,
    url: pull.html_url,
  }
}

function pullState(pull: v.InferOutput<typeof pullSchema>): GitPullRequest['state'] {
  if (pull.merged === true) return 'merged'
  if (pull.state === 'closed') return 'closed'
  return 'open'
}
