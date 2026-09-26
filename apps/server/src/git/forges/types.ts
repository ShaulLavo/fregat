import type {
  GitForge,
  GitForgeKind,
  GitPullRequest,
  GitPullRequestSupport,
  GitRepositoryVisibility,
} from '@workspace/contracts'
import type { runBoundedProcess } from '../utils/process'

export type RunProcess = typeof runBoundedProcess

/** Everything a provider call needs: the checkout, what its remote names, and the boundaries. */
export type ForgeContext = {
  readonly cwd: string
  readonly forge: GitForge
  readonly remoteUrl: string
  /** The remote the forge was found on; empty when publishing to a repository not yet added. */
  readonly remoteName: string
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
  /**
   * The newest pull request per branch in the requested states, or null for proven absence. A
   * branch left out of the map is unknown: a bounded scan ended before it was found.
   */
  pullRequests: (
    context: ForgeContext,
    query: PullRequestQuery,
  ) => Promise<ReadonlyMap<string, GitPullRequest | null>>
  pullRequestsByNumber?: (
    context: ForgeContext,
    numbers: readonly number[],
  ) => Promise<ReadonlyMap<number, GitPullRequest>>
  createPullRequest: (context: ForgeContext, input: CreatePullRequestInput) => Promise<void>
  /** One request by number, with what a checkout of its head needs. */
  getPullRequest: (context: ForgeContext, number: number) => Promise<PullRequestDetail>
  /** Creates `context.repository` on the forge and says where to reach it. */
  createRepository: (
    context: ForgeContext,
    visibility: GitRepositoryVisibility,
  ) => Promise<CreatedRepository>
}

export type CreatedRepository = {
  readonly url: string
  readonly httpsUrl: string
  readonly sshUrl: string
}

type PullRequestDetail = GitPullRequest & {
  readonly headRefName: string
  readonly baseRefName: string
  /** From a fork: its branch is not on this repository's remote. */
  readonly crossRepository: boolean
  /** The ref on this repository's remote that holds the head commit. */
  readonly headSource?: { readonly url: string; readonly commit: string }
  readonly headFetchRef: string
}
