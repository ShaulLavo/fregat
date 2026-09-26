import { defineErrorCatalog } from 'evlog'

import { writeProcessInput } from '../command'
import type { GitCommandResult } from '../types'

/**
 * Per-command output budget. 10 MB is the largest patch or listing we are
 * willing to hold in memory for one request; past that the reader stops, the
 * partial output is dropped, and the caller gets a typed failure instead of a
 * diff that looks complete but is not.
 */
export const MAX_OUTPUT_BYTES = 10_000_000

/**
 * Local commands (status, diff, rev-parse, cat-file) only touch the working
 * tree and the object store, so 30s already means something is wedged — a
 * stale `index.lock`, a hung hook, or a filesystem that stopped answering.
 */
export const LOCAL_TIMEOUT_MS = 30_000

/**
 * Network commands wait on a remote: DNS, TLS, SSH auth, then a pack transfer.
 * 2 minutes covers a cold fetch on a slow link while still guaranteeing an
 * unreachable remote cannot pin a request (and its git process) forever.
 */
export const NETWORK_TIMEOUT_MS = 120_000

/**
 * Commands that run the repository's hooks run arbitrary user code: a pre-commit
 * that typechecks a monorepo takes minutes and is healthy the whole time. Their
 * output streams to the user, so a slow hook is visible rather than silent; this
 * only bounds one that never returns.
 */
export const HOOK_TIMEOUT_MS = 15 * 60_000

const NETWORK_ACTIONS = new Set(['clone', 'fetch', 'ls-remote', 'pull', 'remote'])
const HOOK_ACTIONS = new Set(['am', 'cherry-pick', 'commit', 'merge', 'push', 'rebase', 'revert'])

export const gitProcessErrors = defineErrorCatalog('git', {
  COMMAND_TIMED_OUT: {
    status: 504,
    message: ({ action, timeoutMs }: { action: string; timeoutMs: number }) =>
      `git ${action} did not finish within ${formatTimeout(timeoutMs)} and was killed`,
    why: 'The git subprocess exceeded its time budget: network commands wait on an unreachable or unauthenticated remote, local ones usually block on a stale index lock or a hook.',
    fix: 'Check the remote (or clear the stale git lock) and retry. Raise timeoutMs for that call only when the command is legitimately slower than the budget.',
  },
  OUTPUT_LIMIT_EXCEEDED: {
    status: 413,
    message: ({ action, maxBytes, stream }: { action: string; maxBytes: number; stream: string }) =>
      `git ${action} wrote more than ${maxBytes} bytes to ${stream}`,
    why: 'Buffering the whole output would grow the server heap without bound, so the read stops at the limit and discards the partial output.',
    fix: 'Narrow the command (fewer paths, a smaller revision range) or raise maxOutputBytes for that call when the large output is expected.',
  },
})

export type GitProcessLimit =
  | {
      kind: 'output-limit'
      maxBytes: number
      observedBytes: number
      stream: 'stdout' | 'stderr'
    }
  | { kind: 'timeout'; timeoutMs: number }

/** A finished command, plus the limit that cut it short when one did. */
export type GitProcessResult = GitCommandResult & { limit?: GitProcessLimit }

export type GitProcessInput = {
  args: readonly string[]
  cwd: string
  /**
   * Extra environment for this command only, merged over the server's own env.
   * Checkpoint capture relies on it for `GIT_INDEX_FILE`: the whole point is to
   * stage into a throwaway index without ever touching the user's real one.
   */
  env?: Readonly<Record<string, string>>
  input?: string
  maxOutputBytes?: number
  timeoutMs?: number
}

/**
 * Runs `git` with both of its unbounded edges closed: output is read through a
 * byte budget and the whole command is killed once its deadline passes. A
 * command that hits either limit comes back with `limit` set and no output —
 * callers turn that into `gitProcessErrors`, never into a usable result.
 */
export async function runProcess(input: GitProcessInput): Promise<GitProcessResult> {
  return runBoundedProcess({
    ...input,
    argv: ['git', '-C', input.cwd].concat(input.args),
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs(input.args),
  })
}

/**
 * The same two closed edges for a command that is not `git`. `gh` is the only
 * other binary we shell out to, and it waits on GitHub, so it needs the byte
 * budget and the deadline for exactly the reasons git's network commands do.
 */
export async function runBoundedProcess(
  input: Omit<GitProcessInput, 'args'> & {
    argv: readonly string[]
    /** Kills the whole process group, so grandchildren (a spawned `tsc`) die with the child. */
    processGroup?: boolean
    signal?: AbortSignal
  },
): Promise<GitProcessResult> {
  const maxBytes = input.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const timeoutMs = input.timeoutMs ?? NETWORK_TIMEOUT_MS
  const child = Bun.spawn(input.argv.slice(), {
    cwd: input.cwd,
    // Bun replaces the environment wholesale when `env` is set, so an override
    // has to be layered over the inherited one or git loses PATH and HOME.
    ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
    stderr: 'pipe',
    stdin: input.input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    ...(input.processGroup ? { detached: true } : {}),
  })
  const control = createReadControl()
  const stop = () => (input.processGroup ? killGroup(child) : killIfRunning(child))
  let timedOut = false
  // Aborting the readers matters as much as the kill: git's own children (ssh,
  // git-remote-https) inherit the pipes, so waiting for EOF after killing git
  // would hang exactly as long as the command we are trying to bound.
  const timer = setTimeout(() => {
    timedOut = true
    control.abort()
    stop()
  }, timeoutMs)
  const onAbort = () => {
    control.abort()
    stop()
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })
  if (input.signal?.aborted) onAbort()

  try {
    if (input.input !== undefined) await writeProcessInput(child.stdin, input.input)

    const [stdout, stderr] = await Promise.all([
      readCapped(child.stdout, maxBytes, control),
      readCapped(child.stderr, maxBytes, control),
    ])
    // A writer blocked on a full pipe never exits, so stop it before waiting.
    if (stdout.truncated || stderr.truncated) killIfRunning(child)

    const exitCode = await child.exited
    input.signal?.throwIfAborted()
    const limit = processLimit({ maxBytes, stderr, stdout, timedOut, timeoutMs })
    if (!limit) return { exitCode, stderr: stderr.text, stdout: stdout.text }

    return { exitCode, limit, stderr: '', stdout: '' }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
    stop()
  }
}

export function processLimitError(limit: GitProcessLimit, action: string) {
  if (limit.kind === 'timeout') {
    return gitProcessErrors.COMMAND_TIMED_OUT({ action, timeoutMs: limit.timeoutMs })
  }

  return gitProcessErrors.OUTPUT_LIMIT_EXCEEDED({
    action,
    internal: { observedBytes: limit.observedBytes },
    maxBytes: limit.maxBytes,
    stream: limit.stream,
  })
}

export function defaultTimeoutMs(args: readonly string[]) {
  const action = args[0] ?? ''
  if (HOOK_ACTIONS.has(action)) return HOOK_TIMEOUT_MS
  if (NETWORK_ACTIONS.has(action)) return NETWORK_TIMEOUT_MS

  return LOCAL_TIMEOUT_MS
}

type StreamRead = { bytes: number; text: string; truncated: boolean }

type ReadControl = { aborted: Promise<typeof ABORTED>; abort: () => void }

const ABORTED = Symbol('git.read.aborted')

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  control: ReadControl,
): Promise<StreamRead> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''

  while (true) {
    const chunk = await Promise.race([reader.read(), control.aborted])
    if (chunk === ABORTED) return abandonRead(reader, bytes, maxBytes)
    if (chunk.done) return { bytes, text: text + decoder.decode(), truncated: false }

    bytes += chunk.value.byteLength
    if (bytes > maxBytes) {
      control.abort()
      return abandonRead(reader, bytes, maxBytes)
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
}

/** Drops what was read: a partial diff is worse than no diff. */
function abandonRead(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bytes: number,
  maxBytes: number,
): StreamRead {
  void reader.cancel()

  return { bytes, text: '', truncated: bytes > maxBytes }
}

function createReadControl(): ReadControl {
  let resolveAborted: (value: typeof ABORTED) => void = () => {}
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve
  })

  return { abort: () => resolveAborted(ABORTED), aborted }
}

function processLimit(input: {
  maxBytes: number
  stderr: StreamRead
  stdout: StreamRead
  timedOut: boolean
  timeoutMs: number
}): GitProcessLimit | null {
  if (input.timedOut) return { kind: 'timeout', timeoutMs: input.timeoutMs }
  if (input.stdout.truncated) return outputLimit(input.stdout, input.maxBytes, 'stdout')
  if (input.stderr.truncated) return outputLimit(input.stderr, input.maxBytes, 'stderr')

  return null
}

function outputLimit(
  read: StreamRead,
  maxBytes: number,
  stream: 'stdout' | 'stderr',
): GitProcessLimit {
  return { kind: 'output-limit', maxBytes, observedBytes: read.bytes, stream }
}

// The group outlives its leader, so it is signalled even after the child exited.
function killGroup(child: Bun.Subprocess) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // ESRCH: every member already exited.
  }
}

function killIfRunning(child: Bun.Subprocess) {
  if (child.exitCode !== null) return
  if (child.signalCode !== null) return

  child.kill('SIGKILL')
}

/** One line of a running command's output, tagged with the pipe it came from. */
type GitProcessLine = {
  readonly stream: 'stderr' | 'stdout'
  readonly text: string
}

export type GitProcessEvent =
  | { readonly kind: 'line'; readonly line: GitProcessLine }
  | {
      readonly kind: 'exit'
      readonly exitCode: number
      readonly limit?: GitProcessLimit
    }

/**
 * The same command as `runProcess`, reported line by line as it runs.
 *
 * A commit runs the repository's hooks, and a hook that takes forty seconds is
 * indistinguishable from a wedged one when its output only arrives at the end —
 * which is the whole reason this exists. Both of `runProcess`'s bounds still
 * apply: lines are counted against the same byte budget, and the deadline still
 * kills the process, so streaming does not reopen either unbounded edge.
 */
export async function* streamProcess(input: GitProcessInput): AsyncGenerator<GitProcessEvent> {
  const maxBytes = input.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs(input.args)
  const child = Bun.spawn(['git', '-C', input.cwd].concat(input.args), {
    ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
    stderr: 'pipe',
    stdin: input.input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killIfRunning(child)
  }, timeoutMs)

  try {
    if (input.input !== undefined) await writeProcessInput(child.stdin, input.input)

    const budget = { remaining: maxBytes }
    // Interleaved rather than sequential: hooks write progress to stderr while
    // git writes its summary to stdout, and draining one pipe at a time lets
    // the other fill and block the process we are trying to watch.
    yield* mergeProcessLines([
      readProcessLines(child.stdout, 'stdout', budget),
      readProcessLines(child.stderr, 'stderr', budget),
    ])

    const exitCode = await child.exited
    if (timedOut) {
      yield { exitCode, kind: 'exit', limit: { kind: 'timeout', timeoutMs } }
      return
    }
    if (budget.remaining <= 0) {
      yield {
        exitCode,
        kind: 'exit',
        limit: { kind: 'output-limit', maxBytes, observedBytes: maxBytes, stream: 'stdout' },
      }
      return
    }

    yield { exitCode, kind: 'exit' }
  } finally {
    clearTimeout(timer)
    killIfRunning(child)
  }
}

/**
 * Reads a pipe into whole lines, stopping once the shared budget is spent. The
 * budget is shared so one runaway pipe cannot spend the other's allowance.
 */
async function* readProcessLines(
  stream: ReadableStream<Uint8Array> | undefined,
  name: 'stderr' | 'stdout',
  budget: { remaining: number },
): AsyncGenerator<GitProcessLine> {
  if (!stream) return

  const decoder = new TextDecoder()
  let buffered = ''

  for await (const chunk of stream) {
    if (budget.remaining <= 0) return

    budget.remaining -= chunk.byteLength
    buffered += decoder.decode(chunk, { stream: true })
    const lines = buffered.split('\n')
    // The tail is whatever follows the last newline — a partial line the next
    // chunk finishes, or the final line if the process ends here.
    buffered = lines.pop() ?? ''

    for (const text of lines) {
      yield { stream: name, text }
    }
  }
  if (buffered.length > 0) yield { stream: name, text: buffered }
}

/** Yields from every generator as it produces, rather than one after another. */
async function* mergeProcessLines(sources: AsyncGenerator<GitProcessLine>[]) {
  const pending = new Map(
    sources.map((source, index) => [index, source.next().then((result) => ({ index, result }))]),
  )

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values())
    if (result.done) {
      pending.delete(index)
      continue
    }

    yield { kind: 'line' as const, line: result.value }
    const source = sources[index]!
    pending.set(
      index,
      source.next().then((next) => ({ index, result: next })),
    )
  }
}

function formatTimeout(timeoutMs: number) {
  if (timeoutMs >= 60_000) return `${Math.round(timeoutMs / 60_000)} min`

  return `${Math.round(timeoutMs / 1000)}s`
}
