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

const supportByCwd = new Map<string, { at: number; support: GitPullRequestSupport }>()

const pullRequestSchema = v.object({
  isDraft: v.boolean(),
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  state: v.picklist(['OPEN', 'CLOSED', 'MERGED']),
  title: v.string(),
  url: v.pipe(v.string(), v.url()),
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

  const support = await probePullRequestSupport(cwd, runProcess)
  supportByCwd.set(cwd, { at: Date.now(), support })

  return support
}

async function probePullRequestSupport(
  cwd: string,
  runProcess: RunProcess,
): Promise<GitPullRequestSupport> {
  const status = await gh(cwd, ['auth', 'status'], runProcess)
  // Bun reports a missing binary as a spawn failure, which surfaces here as a
  // non-zero exit with nothing on either pipe.
  if (status.exitCode !== 0 && !status.stderr && !status.stdout) return 'cli-missing'
  if (status.exitCode !== 0) return 'unauthenticated'

  const remote = await gh(cwd, ['repo', 'view', '--json', 'url'], runProcess)
  if (remote.exitCode !== 0) return 'no-github-remote'

  return 'ready'
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

function parsePullRequest(stdout: string): GitPullRequest | null {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch (cause) {
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: 'json-parse', outputLength: stdout.length },
    })
  }
  const parsed = v.safeParse(v.array(pullRequestSchema), json)
  if (!parsed.success)
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      internal: {
        at: 'schema',
        issueCount: parsed.issues.length,
        summary: v.summarize(parsed.issues),
      },
    })
  const pullRequest = parsed.output[0]
  if (!pullRequest) return null

  return {
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
