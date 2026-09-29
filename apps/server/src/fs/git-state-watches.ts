import path from 'node:path'
import type { WatchServerMessage } from './contracts'
import type { NativeWatchHost } from './native-watch-host'
import type { WorkspacePaths } from './path'

type GitDirectories = {
  /** The checkout's top level: what a `git` message names. */
  readonly worktree: string
  /** This checkout's own directory: `.git`, or `.git/worktrees/<name>` for a linked worktree. */
  readonly gitDir: string
  /** Where refs live; the main checkout's `.git` for every linked worktree. */
  readonly commonDir: string
}

type Entry = {
  holders: number
  closers: (() => void)[]
  timer: ReturnType<typeof setTimeout> | null
}

// A commit writes the index, a ref and HEAD's reflog within a few milliseconds; one message covers them.
const coalesceMs = 50
const revParseTimeoutMs = 5_000

// The first-level names whose change moves status or the branch; objects, logs and hooks never do.
const TRACKED_NAMES = new Set(['HEAD', 'index', 'packed-refs', 'config', 'config.worktree'])
const TRACKED_DIRECTORIES = new Set(['refs', 'reftable', 'rebase-merge', 'rebase-apply'])

/**
 * Watches the git directories behind each streamed root, wherever they live: a linked worktree's
 * `.git` is a file pointing into the main checkout, and a subfolder's repository sits above it.
 */
export class GitStateWatches {
  private readonly entries = new Map<string, Entry>()
  private readonly native: NativeWatchHost
  private readonly paths: WorkspacePaths
  private readonly emit: (event: WatchServerMessage) => void

  constructor(
    native: NativeWatchHost,
    paths: WorkspacePaths,
    emit: (event: WatchServerMessage) => void,
  ) {
    this.native = native
    this.paths = paths
    this.emit = emit
  }

  async retain(relativeRoot: string): Promise<() => void> {
    const directories = await resolveGitDirectories(this.paths.resolve(relativeRoot).absolutePath)
    if (!directories) return noop
    const worktree = this.relative(directories.worktree) ?? relativeRoot
    const existing = this.entries.get(worktree)
    if (existing) {
      existing.holders += 1
      return () => this.release(worktree)
    }
    const entry: Entry = { holders: 1, closers: [], timer: null }
    this.entries.set(worktree, entry)
    const onEvent = (base: string, filename: string) => {
      if (isGitStateChange(base, filename)) this.schedule(worktree, entry)
    }
    const targets = gitWatchTargets(directories)
    await Promise.all(
      targets.map(async ({ directory, recursive, base }) => {
        const result = await this.native.watch(directory, recursive, {
          event: (_event, filename) => onEvent(base, filename),
          error: noop,
        })
        if (result.status === 'attached') entry.closers.push(result.close)
      }),
    )
    // Released while attaching: nothing else will close what just attached.
    if (this.entries.get(worktree) !== entry) closeEntry(entry)
    return () => this.release(worktree)
  }

  close() {
    for (const entry of this.entries.values()) closeEntry(entry)
    this.entries.clear()
  }

  private schedule(worktree: string, entry: Entry) {
    if (entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      if (this.entries.get(worktree) === entry) this.emit({ type: 'git', path: worktree })
    }, coalesceMs)
  }

  private release(worktree: string) {
    const entry = this.entries.get(worktree)
    if (!entry) return
    entry.holders -= 1
    if (entry.holders > 0) return
    this.entries.delete(worktree)
    closeEntry(entry)
  }

  private relative(absolute: string) {
    try {
      return this.paths.toRelative(absolute)
    } catch {
      return null
    }
  }
}

function gitWatchTargets(directories: GitDirectories) {
  const { gitDir, commonDir } = directories
  const targets = [
    { directory: gitDir, recursive: false, base: '' },
    { directory: path.join(commonDir, 'refs'), recursive: true, base: 'refs' },
  ]
  // A linked worktree's HEAD and index are in its own directory; packed-refs and config are shared.
  if (commonDir !== gitDir) targets.push({ directory: commonDir, recursive: false, base: '' })
  return targets
}

/** Whether a change at `filename` below a watched git directory can move status or the branch. */
function isGitStateChange(base: string, filename: string) {
  const relative = base ? `${base}/${filename}` : filename
  if (!relative || relative.endsWith('.lock')) return false
  const [first = '', ...rest] = relative.split('/')
  if (TRACKED_DIRECTORIES.has(first)) return true
  if (rest.length > 0) return false
  return TRACKED_NAMES.has(first) || (first.endsWith('_HEAD') && first !== 'FETCH_HEAD')
}

async function resolveGitDirectories(absoluteRoot: string): Promise<GitDirectories | null> {
  const child = Bun.spawn(
    [
      'git',
      '-C',
      absoluteRoot,
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ],
    { stdout: 'pipe', stderr: 'ignore', timeout: revParseTimeoutMs },
  )
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (exitCode !== 0) return null
  const [worktree, gitDir, commonDir] = output.trim().split('\n')
  if (!worktree || !gitDir || !commonDir) return null
  return { worktree, gitDir, commonDir }
}

function closeEntry(entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  for (const close of entry.closers.splice(0)) close()
}

function noop() {}
