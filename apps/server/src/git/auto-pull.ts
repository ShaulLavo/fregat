import {
  errorMessage,
  type GitAutoPullSkipReason,
  type GitAutoPullState,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability'
import type { SettingsStore } from '../settings/store'
import { gitErrorMessage } from './command'
import { parseRepositoryInfo } from './status'
import { parseUpstreamRemote } from './upstream-fetch'

/** Whether automatic pull is on for the checkout at this absolute root. */
export type AutoPullPolicy = (rootAbsolutePath: string) => Promise<boolean>

/** Only registered project checkouts pull; the project override wins over the machine default. */
export async function autoPullEnabled(
  settings: Pick<SettingsStore, 'snapshot'>,
  projectId: () => Promise<string | null>,
) {
  const values = settings.snapshot().values
  const overrides = values['git.projectAutoPull']
  // Status is polled every second per pane; the common case never resolves a project.
  if (!values['git.autoPull'] && !Object.values(overrides).includes(true)) return false
  const id = await projectId()
  if (!id) return false
  return overrides[id] ?? values['git.autoPull']
}

type Run = (
  root: string,
  args: readonly string[],
  options?: { allowFailure?: boolean },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

// A failed pull is not retried on every status poll.
const FAILURE_COOLDOWN_MS = 60_000
const STATUS_UPSTREAM_PREFIX = '# branch.upstream '

/**
 * Keeps a project checkout on its default branch at its upstream. Evaluated on status reads,
 * after the background fetch has moved the upstream ref; the pull itself runs detached and
 * the next status read sees its result.
 */
export class AutoPull {
  private readonly pulling = new Set<string>()
  private readonly failures = new Map<string, { at: number; message: string }>()
  private readonly policy: AutoPullPolicy
  private readonly run: Run
  private readonly now: () => number
  private readonly onSettled: (root: string) => void

  constructor(options: {
    policy: AutoPullPolicy
    run: Run
    now?: () => number
    onSettled: (root: string) => void
  }) {
    this.policy = options.policy
    this.run = options.run
    this.now = options.now ?? Date.now
    this.onSettled = options.onSettled
  }

  async evaluate(
    root: string,
    statusOutput: string,
    changedFileCount: () => Promise<number>,
  ): Promise<GitAutoPullState | null> {
    if (!(await this.policy(root).catch(() => false))) return null
    if (this.pulling.has(root)) return { state: 'pulling' }
    const failure = this.failures.get(root)
    if (failure && this.now() - failure.at < FAILURE_COOLDOWN_MS)
      return { state: 'failed', message: failure.message }

    const info = parseRepositoryInfo(statusOutput, '')
    if (!info.branch) return skip('detached')
    const upstream = upstreamRef(statusOutput)
    const remote = parseUpstreamRemote(statusOutput)
    if (!upstream || !remote) return skip('no-upstream')
    const defaultRef = await this.remoteDefault(root, remote)
    if (!defaultRef) return skip('no-default-branch')
    const defaultBranch = defaultRef.slice(remote.length + 1)
    if (upstream !== defaultRef) return skip('other-branch', defaultBranch)
    if (info.ahead > 0 && info.behind > 0) return skip('diverged', defaultBranch)
    if (info.ahead > 0) return skip('ahead', defaultBranch)
    if (info.behind === 0) return { state: 'current' }
    if ((await changedFileCount()) > 0) return skip('changes', defaultBranch)

    this.pulling.add(root)
    void this.pull(root, info.behind)
    return { state: 'pulling' }
  }

  private async remoteDefault(root: string, remote: string) {
    const result = await this.run(root, ['rev-parse', '--abbrev-ref', `${remote}/HEAD`], {
      allowFailure: true,
    })
    const ref = result.stdout.trim()
    return result.exitCode === 0 && ref.startsWith(`${remote}/`) ? ref : null
  }

  // `--ff-only` either moves HEAD or changes nothing; it never leaves a merge in progress.
  private async pull(root: string, behind: number) {
    const startedAt = this.now()
    try {
      const result = await this.run(root, ['merge', '--ff-only', '@{u}'], { allowFailure: true })
      if (result.exitCode !== 0) {
        const message = gitErrorMessage(result)
        this.failures.set(root, { at: this.now(), message })
        recordProcessWarning('git.auto_pull.failed', {
          area: 'git',
          root,
          behind,
          exitCode: result.exitCode,
          durationMs: this.now() - startedAt,
        })
        return
      }
      this.failures.delete(root)
      recordProcessInfo('git.auto_pull.pulled', {
        area: 'git',
        root,
        behind,
        durationMs: this.now() - startedAt,
      })
    } catch (error) {
      this.failures.set(root, { at: this.now(), message: errorMessage(error) })
      recordProcessWarning('git.auto_pull.failed', { area: 'git', root, behind, error })
    } finally {
      this.pulling.delete(root)
      this.onSettled(root)
    }
  }
}

function skip(reason: GitAutoPullSkipReason, defaultBranch: string | null = null) {
  return { state: 'skipped', reason, defaultBranch } as const
}

function upstreamRef(statusOutput: string) {
  for (const record of statusOutput.split('\0')) {
    if (record.startsWith(STATUS_UPSTREAM_PREFIX))
      return record.slice(STATUS_UPSTREAM_PREFIX.length)
  }
  return null
}
