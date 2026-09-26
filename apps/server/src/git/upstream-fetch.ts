import { AsyncThrottler } from '@tanstack/pacer/async-throttler'
import { QueryClient } from '@tanstack/query-core'
import { nodeErrorCode } from '@workspace/contracts'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { operatorErrorSummary, recordProcessWarning } from '../observability'

const UPSTREAM_FETCH_INTERVAL_MS = 15_000
const UPSTREAM_FETCH_FAILURE_COOLDOWN_MS = 5_000
const STATUS_UPSTREAM_PREFIX = '# branch.upstream '

type UpstreamFetcher = (rootAbsolutePath: string, remote: string) => Promise<void>

type UpstreamFetchSchedulerOptions = {
  failureCooldownMs?: number
  intervalMs?: number
  repositoryIdentity?: (rootAbsolutePath: string) => Promise<readonly string[] | null>
  resolveCommonDir: (rootAbsolutePath: string) => Promise<string>
  runFetch: UpstreamFetcher
}

/**
 * Keeps upstream ahead/behind counts fresh without hammering the network:
 * every status read schedules a background `git fetch <remote>` that runs at
 * most once per interval per (git common dir, remote). Worktrees share a
 * common dir, so they share one fetch budget. A failed fetch shortens the
 * window to the failure cooldown so a flaky remote retries sooner.
 */
export class UpstreamFetchScheduler {
  private readonly lookups = new QueryClient()
  private readonly throttlersByKey = new Map<string, AsyncThrottler<UpstreamFetcher>>()
  private readonly failureCooldownMs: number
  private readonly intervalMs: number
  private readonly resolveCommonDir: (rootAbsolutePath: string) => Promise<string>
  private readonly runFetch: UpstreamFetcher
  private readonly repositoryIdentity: (
    rootAbsolutePath: string,
  ) => Promise<readonly string[] | null>

  constructor(options: UpstreamFetchSchedulerOptions) {
    this.failureCooldownMs = options.failureCooldownMs ?? UPSTREAM_FETCH_FAILURE_COOLDOWN_MS
    this.intervalMs = options.intervalMs ?? UPSTREAM_FETCH_INTERVAL_MS
    this.resolveCommonDir = options.resolveCommonDir
    this.runFetch = options.runFetch
    this.repositoryIdentity = options.repositoryIdentity ?? repositoryIdentity
  }

  /** Never rejects; production callers fire-and-forget with `void`. */
  async schedule(rootAbsolutePath: string, statusOutput: string) {
    const remote = parseUpstreamRemote(statusOutput)
    if (!remote) return

    const commonDir = await this.commonDir(rootAbsolutePath)
    if (!commonDir) return

    const throttler = this.throttler(`${commonDir}\u0000${remote}`)
    await throttler.maybeExecute(rootAbsolutePath, remote)
  }

  private async commonDir(rootAbsolutePath: string) {
    try {
      const identity = await this.repositoryIdentity(rootAbsolutePath)
      return await this.lookups.query({
        queryKey: ['git', 'common-directory', rootAbsolutePath, ...(identity ?? [])],
        queryFn: () => this.resolveCommonDir(rootAbsolutePath),
        staleTime: identity === null ? 0 : 'static',
        gcTime: 60_000,
        networkMode: 'always',
        retry: false,
      })
    } catch (error) {
      recordProcessWarning('git.upstream_fetch.common_dir_failed', {
        area: 'git',
        error: operatorErrorSummary(error),
        operation: 'upstream_fetch',
        root: rootAbsolutePath,
      })
      return null
    }
  }

  private throttler(key: string) {
    const existing = this.throttlersByKey.get(key)
    if (existing) return existing

    let lastFetchFailed = false
    const throttler = new AsyncThrottler(this.runFetch, {
      // One attempt per throttled execution; retry pacing is the cooldown's job.
      asyncRetryerOptions: { maxAttempts: 1 },
      leading: true,
      onError: (error, [rootAbsolutePath, remote]) => {
        lastFetchFailed = true
        recordProcessWarning('git.upstream_fetch.failed', {
          area: 'git',
          error: operatorErrorSummary(error),
          operation: 'upstream_fetch',
          remote,
          root: rootAbsolutePath,
        })
      },
      onSuccess: () => {
        lastFetchFailed = false
      },
      trailing: false,
      wait: () => (lastFetchFailed ? this.failureCooldownMs : this.intervalMs),
    })
    this.throttlersByKey.set(key, throttler)
    return throttler
  }
}

async function repositoryIdentity(root: string): Promise<readonly string[] | null> {
  const [directory, git] = await Promise.all([
    stat(root, { bigint: true }),
    stat(path.join(root, '.git'), { bigint: true }).catch((error: unknown) => {
      if (nodeErrorCode(error) === 'ENOENT') return null
      throw error
    }),
  ])
  // External GIT_DIR/core.worktree metadata has no local identity; ask Git on each status read.
  if (git === null) return null
  return [
    `${directory.dev}:${directory.ino}:${directory.birthtimeNs}`,
    `${git.dev}:${git.ino}:${git.birthtimeNs}`,
    git.isFile() ? `${git.mtimeNs}:${git.ctimeNs}:${git.size}` : '',
  ]
}

export function parseUpstreamRemote(statusOutput: string) {
  for (const record of statusOutput.split('\0')) {
    if (!record.startsWith(STATUS_UPSTREAM_PREFIX)) continue

    const upstream = record.slice(STATUS_UPSTREAM_PREFIX.length)
    const separatorIndex = upstream.indexOf('/')
    if (separatorIndex <= 0) return null

    return upstream.slice(0, separatorIndex)
  }

  return null
}
