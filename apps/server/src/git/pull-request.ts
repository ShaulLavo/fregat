import type {
  GitForge,
  GitForgeKind,
  GitPublishRequest,
  GitPullRequest,
  GitPullRequestCreateResult,
  GitPullRequestSupport,
} from '@workspace/contracts'

import { detectForge } from './forges/detect'
import { forgeProvider, resolveForgeContext } from './forges/registry'
import type { CreatedRepository, ForgeContext, RunProcess } from './forges/types'
import { gitPullRequestErrors } from './utils/pull-request-errors'
import { runBoundedProcess } from './utils/process'

/**
 * Whether a forge CLI works here changes when someone installs it or signs in, not between two
 * renders of a header. Caching the verdict keeps the probe processes off every read; the window
 * is short enough that signing in shows up on the next poll.
 */
const SUPPORT_CACHE_TTL_MS = 60_000

const supportByRemote = new Map<string, { at: number; support: GitPullRequestSupport }>()

export type ForgeBoundaries = { run?: RunProcess; fetch?: typeof fetch }
type Boundaries = ForgeBoundaries

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

async function supportedContext(
  cwd: string,
  boundaries: Boundaries,
  remoteUrl?: string,
): Promise<Supported> {
  const context = await resolveForgeContext({
    cwd,
    remoteUrl,
    run: boundaries.run ?? runBoundedProcess,
    fetch: boundaries.fetch ?? fetch,
  })
  if (!context) return { support: 'no-forge', forge: null, context: null }
  const support = await cachedSupport(context)
  if (support !== 'ready') return { support, forge: context.forge, context: null }
  return { support, forge: context.forge, context }
}

async function cachedSupport(context: ForgeContext) {
  const key = JSON.stringify([
    context.cwd,
    context.forge.kind,
    context.forge.host,
    context.remoteUrl,
  ])
  const cached = supportByRemote.get(key)
  if (cached && Date.now() - cached.at < SUPPORT_CACHE_TTL_MS) return cached.support
  const support = await forgeProvider(context.forge.kind).support(context)
  supportByRemote.set(key, { at: Date.now(), support })
  return support
}

const PUBLIC_HOSTS: Record<GitForgeKind, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  forgejo: 'codeberg.org',
  'azure-devops': 'dev.azure.com',
  bitbucket: 'bitbucket.org',
}

const SUPPORT_REASONS = {
  'cli-missing': 'its command-line tool is not installed',
  unauthenticated: 'nobody is signed in',
} as const

/** Creates the repository a publish names, on the forge the user chose. */
export async function createForgeRepository(
  request: Pick<GitPublishRequest, 'forge' | 'host' | 'repository' | 'visibility'>,
  cwd: string,
  boundaries: Boundaries = {},
): Promise<CreatedRepository> {
  const host = request.host?.trim().toLowerCase() || PUBLIC_HOSTS[request.forge]
  const forge = publishForge(request.forge, host)
  const context: ForgeContext = {
    cwd,
    forge,
    remoteUrl: '',
    remoteName: '',
    repository: request.repository.trim().replace(/^\/+|\/+$/g, ''),
    run: boundaries.run ?? runBoundedProcess,
    fetch: boundaries.fetch ?? fetch,
  }
  const provider = forgeProvider(request.forge)
  const support = await provider.support(context)
  if (support !== 'ready')
    throw gitPullRequestErrors.FORGE_NOT_READY({
      forge: context.forge.name,
      reason: SUPPORT_REASONS[support],
      internal: { support },
    })
  return provider.createRepository(context, request.visibility)
}

/** A pull request by reference, from the forge a checkout's remote names, with its remote. */
export async function resolvePullRequest(
  input: { cwd: string; number: number; remoteUrl?: string },
  boundaries: Boundaries = {},
) {
  const supported = await supportedContext(input.cwd, boundaries, input.remoteUrl)
  if (!supported.context)
    throw gitPullRequestErrors.FORGE_NOT_READY({
      forge: supported.forge?.name ?? 'This repository',
      reason:
        supported.support === 'no-forge'
          ? 'no remote points at a known forge'
          : SUPPORT_REASONS[supported.support],
      internal: { support: supported.support },
    })
  const detail = await forgeProvider(supported.forge.kind).getPullRequest(
    supported.context,
    input.number,
  )
  return {
    detail,
    forge: supported.forge,
    remoteName: supported.context.remoteName,
    remoteUrl: supported.context.remoteUrl,
  }
}

function publishForge(kind: GitForgeKind, host: string): GitForge {
  const detected = detectForge(`https://${host}/`)
  const hostname = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
  const mismatch = detected && detected.kind !== kind
  const unsupported =
    (kind === 'bitbucket' && host !== 'bitbucket.org') ||
    (kind === 'azure-devops' && detected?.kind !== kind)
  if (!hostname || mismatch || unsupported)
    throw gitPullRequestErrors.FORGE_HOST_INVALID({ internal: { forge: kind } })
  return detected ?? { kind, name: host, host }
}
