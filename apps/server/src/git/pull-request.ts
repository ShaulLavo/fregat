import {
  errorStringField,
  type GitPullRequest,
  type GitPullRequestCreateResult,
  type GitPullRequestSupport,
} from '@workspace/contracts'

import * as v from 'valibot'

import { gitPullRequestErrors } from './utils/pull-request-errors'
import { runBoundedProcess } from './utils/process'

/**
 * `gh` reaches the network, but only to read one branch's pull request. 20s is
 * long enough for a cold auth handshake and short enough that a wedged CLI
 * cannot hold a header render.
 */
const GH_TIMEOUT_MS = 20_000

const PR_FIELDS = 'isDraft,number,state,title,url'

/**
 * Whether `gh` works here changes when someone installs it or signs in — not
 * between two renders of a header. Caching the verdict keeps the two probe
 * processes off every read; the window is short enough that signing in shows
 * up on the next poll rather than requiring a restart.
 */
const SUPPORT_CACHE_TTL_MS = 60_000

type RepositoryName = { owner: string; name: string }

const supportByCwd = new Map<
  string,
  { at: number; support: GitPullRequestSupport; repository: RepositoryName | null }
>()

/** Aliased connections per GraphQL request; a repository with more branches takes several. */
const BRANCHES_PER_QUERY = 50

const repositoryNameSchema = v.object({
  owner: v.object({ login: v.pipe(v.string(), v.minLength(1)) }),
  name: v.pipe(v.string(), v.minLength(1)),
})

const branchPullRequestsSchema = v.object({
  data: v.object({
    repository: v.record(
      v.string(),
      v.object({
        nodes: v.array(
          v.object({
            ...pullRequestSchemaEntries(),
            state: v.picklist(['OPEN', 'CLOSED', 'MERGED']),
            closedAt: v.nullable(v.string()),
          }),
        ),
      }),
    ),
  }),
})

function pullRequestSchemaEntries() {
  return {
    isDraft: v.boolean(),
    number: v.pipe(v.number(), v.integer(), v.minValue(1)),
    title: v.string(),
    url: v.pipe(v.string(), v.url()),
  }
}

const pullRequestSchema = v.object({
  ...pullRequestSchemaEntries(),
  state: v.picklist(['OPEN', 'CLOSED', 'MERGED']),
})

type RunProcess = typeof runBoundedProcess

export async function readPullRequest(
  input: {
    branch: string
    cwd: string
  },
  runProcess: RunProcess = runBoundedProcess,
): Promise<{ pullRequest: GitPullRequest | null; support: GitPullRequestSupport }> {
  const support = await pullRequestSupport(input.cwd, runProcess)
  if (support !== 'ready') return { pullRequest: null, support }

  const result = await gh(
    input.cwd,
    ['pr', 'list', '--head', input.branch, '--state', 'open', '--limit', '1', '--json', PR_FIELDS],
    runProcess,
  )
  if (result.exitCode !== 0) {
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      internal: { exitCode: result.exitCode, stderr: result.stderr },
    })
  }

  return { pullRequest: parsePullRequest(result.stdout), support: 'ready' }
}

export type BranchPullRequests =
  | { kind: 'unsupported'; support: Exclude<GitPullRequestSupport, 'ready'> }
  /** Every requested branch has an entry: its newest pull request in any state, or null. */
  | { kind: 'ready'; pullRequests: ReadonlyMap<string, GitPullRequest | null> }

/**
 * The newest pull request of each branch in one repository, in one GraphQL request per 50
 * branches rather than one `gh` process per branch. Throws on any failed read: a lookup that
 * did not complete never becomes "no pull request".
 */
export async function readBranchPullRequests(
  input: { cwd: string; branches: readonly string[] },
  runProcess: RunProcess = runBoundedProcess,
): Promise<BranchPullRequests> {
  const support = await pullRequestSupport(input.cwd, runProcess)
  const repository = supportByCwd.get(input.cwd)?.repository
  if (support !== 'ready') return { kind: 'unsupported', support }
  if (!repository)
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({ internal: { at: 'repository-name' } })

  const pullRequests = new Map<string, GitPullRequest | null>()
  const branches = [...new Set(input.branches)]
  for (let start = 0; start < branches.length; start += BRANCHES_PER_QUERY) {
    const chunk = branches.slice(start, start + BRANCHES_PER_QUERY)
    const found = await queryBranchPullRequests(input.cwd, repository, chunk, runProcess)
    chunk.forEach((branch, index) => pullRequests.set(branch, found[index] ?? null))
  }
  return { kind: 'ready', pullRequests }
}

async function queryBranchPullRequests(
  cwd: string,
  repository: RepositoryName,
  branches: readonly string[],
  runProcess: RunProcess,
) {
  // Branch names travel as variables, never inside the query text.
  const variables = branches.map((_, index) => `$h${index}: String!`).join(', ')
  const fields = branches
    .map(
      (_, index) =>
        `b${index}: pullRequests(headRefName: $h${index}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}, states: [OPEN, CLOSED, MERGED]) { nodes { number title url state isDraft closedAt } }`,
    )
    .join(' ')
  const query = `query($owner: String!, $name: String!, ${variables}) { repository(owner: $owner, name: $name) { ${fields} } }`
  const result = await gh(
    cwd,
    [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${repository.owner}`,
      '-f',
      `name=${repository.name}`,
      ...branches.flatMap((branch, index) => ['-f', `h${index}=${branch}`]),
    ],
    runProcess,
  )
  if (result.exitCode !== 0) {
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      internal: {
        at: 'graphql',
        exitCode: result.exitCode,
        branchCount: branches.length,
        rateLimited: /rate limit/i.test(result.stderr),
      },
    })
  }
  const parsed = v.safeParse(branchPullRequestsSchema, parseJsonOutput(result.stdout))
  if (!parsed.success)
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      internal: { at: 'graphql-schema', summary: v.summarize(parsed.issues) },
    })
  return branches.map((_, index) => {
    const node = parsed.output.data.repository[`b${index}`]?.nodes[0]
    return node ? toPullRequest(node) : null
  })
}

export async function createPullRequest(
  input: {
    base?: string
    body?: string
    branch: string
    cwd: string
    draft?: boolean
    title: string
  },
  runProcess: RunProcess = runBoundedProcess,
): Promise<GitPullRequestCreateResult> {
  const existing = await readPullRequest({ branch: input.branch, cwd: input.cwd }, runProcess)
  if (existing.support !== 'ready') return { kind: 'unsupported', support: existing.support }
  // A branch carries at most one open pull request, so the honest answer to a
  // second request is the first one — not a second call that `gh` will reject.
  if (existing.pullRequest) return { kind: 'exists', pullRequest: existing.pullRequest }

  const result = await gh(
    input.cwd,
    [
      'pr',
      'create',
      '--head',
      input.branch,
      '--title',
      input.title,
      '--body',
      input.body ?? '',
      ...(input.base ? ['--base', input.base] : []),
      ...(input.draft ? ['--draft'] : []),
    ],
    runProcess,
  )
  if (result.exitCode !== 0) {
    throw gitPullRequestErrors.PULL_REQUEST_CREATE_FAILED({
      branch: input.branch,
      internal: { stderr: result.stderr || result.stdout },
    })
  }

  // `gh pr create` prints the URL, not JSON. Reading the branch back is what
  // turns that into the same shape every other caller already handles.
  const created = await readPullRequest({ branch: input.branch, cwd: input.cwd }, runProcess)
  if (!created.pullRequest) {
    throw gitPullRequestErrors.PULL_REQUEST_CREATE_FAILED({
      branch: input.branch,
      internal: { stdout: result.stdout },
    })
  }

  return { kind: 'created', pullRequest: created.pullRequest }
}

async function pullRequestSupport(
  cwd: string,
  runProcess: RunProcess,
): Promise<GitPullRequestSupport> {
  const cached = supportByCwd.get(cwd)
  if (cached && Date.now() - cached.at < SUPPORT_CACHE_TTL_MS) return cached.support

  const probe = await probePullRequestSupport(cwd, runProcess)
  supportByCwd.set(cwd, { at: Date.now(), ...probe })

  return probe.support
}

async function probePullRequestSupport(
  cwd: string,
  runProcess: RunProcess,
): Promise<{ support: GitPullRequestSupport; repository: RepositoryName | null }> {
  const status = await gh(cwd, ['auth', 'status'], runProcess)
  // Bun reports a missing binary as a spawn failure, which surfaces here as a
  // non-zero exit with nothing on either pipe.
  if (status.exitCode !== 0 && !status.stderr && !status.stdout)
    return { support: 'cli-missing', repository: null }
  if (status.exitCode !== 0) return { support: 'unauthenticated', repository: null }

  const remote = await gh(cwd, ['repo', 'view', '--json', 'owner,name'], runProcess)
  if (remote.exitCode !== 0) return { support: 'no-github-remote', repository: null }

  return { support: 'ready', repository: repositoryName(remote.stdout) }
}

// Only the batched lookup needs the name; a single-branch read works without it.
function repositoryName(stdout: string): RepositoryName | null {
  try {
    const parsed = v.safeParse(repositoryNameSchema, JSON.parse(stdout))
    return parsed.success ? { owner: parsed.output.owner.login, name: parsed.output.name } : null
  } catch {
    return null
  }
}

async function gh(cwd: string, args: readonly string[], runProcess: RunProcess) {
  const result = await runGh(cwd, args, runProcess)
  if (result.limit?.kind === 'timeout') {
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_TIMED_OUT({ internal: result.limit })
  }
  if (result.limit) {
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({ internal: result.limit })
  }
  return result
}

async function runGh(cwd: string, args: readonly string[], runProcess: RunProcess) {
  try {
    return await runProcess({ argv: ['gh', ...args], cwd, timeoutMs: GH_TIMEOUT_MS })
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'ENOENT' &&
      args[0] === 'auth'
    ) {
      return { exitCode: 127, stderr: '', stdout: '' }
    }
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: 'gh-spawn', command: args[0], errorCode: errorStringField(cause, 'code') },
    })
  }
}

function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (cause) {
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: 'json-parse', outputLength: stdout.length },
    })
  }
}

function parsePullRequest(stdout: string): GitPullRequest | null {
  const parsed = v.safeParse(v.array(pullRequestSchema), parseJsonOutput(stdout))
  if (!parsed.success)
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      internal: {
        at: 'schema',
        issueCount: parsed.issues.length,
        summary: v.summarize(parsed.issues),
      },
    })
  const pullRequest = parsed.output[0]
  return pullRequest ? toPullRequest(pullRequest) : null
}

function toPullRequest(
  pullRequest: v.InferOutput<typeof pullRequestSchema> & { closedAt?: string | null },
): GitPullRequest {
  return {
    ...(pullRequest.closedAt === undefined ? {} : { closedAt: pullRequest.closedAt }),
    draft: pullRequest.isDraft,
    number: pullRequest.number,
    state: pullRequestState(pullRequest.state),
    title: pullRequest.title,
    url: pullRequest.url,
  }
}

function pullRequestState(
  value: v.InferOutput<typeof pullRequestSchema>['state'],
): GitPullRequest['state'] {
  if (value === 'MERGED') return 'merged'
  if (value === 'CLOSED') return 'closed'
  return 'open'
}
