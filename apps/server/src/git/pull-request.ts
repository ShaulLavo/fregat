import type {
  GitForge,
  GitPullRequest,
  GitPullRequestCreateResult,
  GitPullRequestSupport,
} from '@workspace/contracts'

import { forgeProvider, resolveForgeContext } from './forges/registry'
import type { ForgeContext, RunProcess } from './forges/types'
import { gitPullRequestErrors } from './utils/pull-request-errors'
import { runBoundedProcess } from './utils/process'

/**
 * Whether a forge CLI works here changes when someone installs it or signs in, not between two
 * renders of a header. Caching the verdict keeps the probe processes off every read; the window
 * is short enough that signing in shows up on the next poll.
 */
const SUPPORT_CACHE_TTL_MS = 60_000

const supportByCwd = new Map<string, { at: number; support: GitPullRequestSupport }>()

type Boundaries = { run?: RunProcess; fetch?: typeof fetch }

type Supported =
  | { support: Exclude<GitPullRequestSupport, 'ready'>; forge: GitForge | null; context: null }
  | { support: 'ready'; forge: GitForge; context: ForgeContext }

export async function readPullRequest(
  input: { branch: string; cwd: string },
  boundaries: Boundaries = {},
): Promise<{
  pullRequest: GitPullRequest | null
  support: GitPullRequestSupport
  forge: GitForge | null
}> {
  const supported = await supportedContext(input.cwd, boundaries)
  if (!supported.context)
    return { pullRequest: null, support: supported.support, forge: supported.forge }
  const found = await forgeProvider(supported.forge.kind).pullRequests(supported.context, {
    branches: [input.branch],
    state: 'open',
  })
  return { pullRequest: found.get(input.branch) ?? null, support: 'ready', forge: supported.forge }
}

export type BranchPullRequests =
  | { kind: 'unsupported'; support: Exclude<GitPullRequestSupport, 'ready'> }
  /** Every requested branch has an entry: its newest pull request in any state, or null. */
  | { kind: 'ready'; pullRequests: ReadonlyMap<string, GitPullRequest | null> }

/**
 * The newest pull request of each branch in one repository. GitHub answers every branch in one
 * GraphQL request; the other forges pay one request per branch. Throws on any failed read: a
 * lookup that did not complete never becomes "no pull request".
 */
export async function readBranchPullRequests(
  input: { cwd: string; branches: readonly string[] },
  boundaries: Boundaries = {},
): Promise<BranchPullRequests> {
  const supported = await supportedContext(input.cwd, boundaries)
  if (!supported.context) return { kind: 'unsupported', support: supported.support }
  const pullRequests = await forgeProvider(supported.forge.kind).pullRequests(supported.context, {
    branches: input.branches,
    state: 'all',
  })
  return { kind: 'ready', pullRequests }
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
  boundaries: Boundaries = {},
): Promise<GitPullRequestCreateResult> {
  const existing = await readPullRequest({ branch: input.branch, cwd: input.cwd }, boundaries)
  if (existing.support !== 'ready') return { kind: 'unsupported', support: existing.support }
  // A branch carries at most one open pull request, so the honest answer to a
  // second request is the first one — not a second call the forge will reject.
  if (existing.pullRequest) return { kind: 'exists', pullRequest: existing.pullRequest }

  const supported = await supportedContext(input.cwd, boundaries)
  if (!supported.context) return { kind: 'unsupported', support: supported.support }
  await forgeProvider(supported.forge.kind).createPullRequest(supported.context, {
    branch: input.branch,
    title: input.title,
    body: input.body ?? '',
    draft: input.draft ?? false,
    ...(input.base ? { base: input.base } : {}),
  })

  // Not every forge prints the new pull request; reading the branch back gives one shape.
  const created = await readPullRequest({ branch: input.branch, cwd: input.cwd }, boundaries)
  if (!created.pullRequest)
    throw gitPullRequestErrors.PULL_REQUEST_CREATE_FAILED({
      branch: input.branch,
      forge: supported.forge.name,
      internal: { at: 'read-back' },
    })
  return { kind: 'created', pullRequest: created.pullRequest }
}

async function supportedContext(cwd: string, boundaries: Boundaries): Promise<Supported> {
  const context = await resolveForgeContext({
    cwd,
    run: boundaries.run ?? runBoundedProcess,
    fetch: boundaries.fetch ?? fetch,
  })
  if (!context) return { support: 'no-forge', forge: null, context: null }
  const support = await cachedSupport(context)
  if (support !== 'ready') return { support, forge: context.forge, context: null }
  return { support, forge: context.forge, context }
}

async function cachedSupport(context: ForgeContext) {
  const cached = supportByCwd.get(context.cwd)
  if (cached && Date.now() - cached.at < SUPPORT_CACHE_TTL_MS) return cached.support
  const support = await forgeProvider(context.forge.kind).support(context)
  supportByCwd.set(context.cwd, { at: Date.now(), support })
  return support
}
