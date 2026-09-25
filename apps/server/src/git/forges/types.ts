import type {
  GitForge,
  GitForgeKind,
  GitPullRequest,
  GitPullRequestSupport,
} from '@workspace/contracts'
import type { runBoundedProcess } from '../utils/process'

export type RunProcess = typeof runBoundedProcess

/** Everything a provider call needs: the checkout, what its remote names, and the boundaries. */
export type ForgeContext = {
  readonly cwd: string
  readonly forge: GitForge
  readonly remoteUrl: string
  /** `owner/repo`, `group/sub/project` or `org/project/_git/repo`, from the remote. */
  readonly repository: string | null
  readonly run: RunProcess
  readonly fetch: typeof fetch
}

type PullRequestQuery = { readonly branches: readonly string[]; readonly state: 'open' | 'all' }

type CreatePullRequestInput = {
  readonly branch: string
  readonly base?: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
}

/**
 * One hosting service. Upstream's `SourceControlProvider`, narrowed to what Platform calls; each
 * implementation copies upstream's commands for its CLI or API.
 */
export type ForgeProvider = {
  readonly kind: GitForgeKind
  support: (context: ForgeContext) => Promise<Exclude<GitPullRequestSupport, 'no-forge'>>
  /** The newest pull request per branch in the requested states, or null for proven absence. */
  pullRequests: (
    context: ForgeContext,
    query: PullRequestQuery,
  ) => Promise<ReadonlyMap<string, GitPullRequest | null>>
  createPullRequest: (context: ForgeContext, input: CreatePullRequestInput) => Promise<void>
}
