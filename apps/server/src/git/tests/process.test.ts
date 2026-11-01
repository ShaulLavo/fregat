import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspacePaths } from '../../fs/path'
import { withGitRepositoryLane, withGitRepositoryLaneStream } from '../repository-lane'
import { GitService } from '../service'
import {
  createReadControl,
  defaultTimeoutMs,
  HOOK_TIMEOUT_MS,
  gitProcessErrors,
  type GitProcessEvent,
  LOCAL_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  readCapped,
  runBoundedProcess,
  runProcess,
  streamProcess,
} from '../utils/process'

const BIG_BLOB_BYTES = 2_000_000
const roots: string[] = []
const fixturePidFiles: string[] = []
const fixtureCollections: { settled: boolean; promise: Promise<unknown> }[] = []

afterEach(async () => {
  await killFixturePids(fixturePidFiles.splice(0))
  for (const collection of fixtureCollections.splice(0)) {
    await expect.poll(() => collection.settled, { timeout: 1_000 }).toBe(true)
    await collection.promise
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('capped stream reads', () => {
  it('preserves output exactly at the byte cap across UTF-8 chunks', async () => {
    const text = 'é'.repeat(512)
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 511))
        controller.enqueue(bytes.subarray(511))
        controller.close()
      },
    })

    const result = await readCapped(stream, bytes.byteLength, createReadControl())

    expect(result).toEqual({ bytes: 1024, text, truncated: false })
  })

  it.for([
    { chunks: [512, 512, 1, BIG_BLOB_BYTES], expectedReads: 3, observedBytes: 1025 },
    { chunks: [512, 1_703_936, BIG_BLOB_BYTES], expectedReads: 2, observedBytes: 1_704_448 },
    { chunks: [BIG_BLOB_BYTES, BIG_BLOB_BYTES], expectedReads: 1, observedBytes: BIG_BLOB_BYTES },
  ])('stops after the first chunk past the cap: $observedBytes bytes', async (fixture) => {
    const maxBytes = 1024
    let reads = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const size = fixture.chunks[reads++]
          if (size === undefined) {
            controller.close()
            return
          }
          controller.enqueue(new Uint8Array(size))
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 },
    )

    const result = await readCapped(stream, maxBytes, createReadControl())

    expect(result).toEqual({ bytes: fixture.observedBytes, text: '', truncated: true })
    expect(reads).toBe(fixture.expectedReads)
    expect(cancelled).toBe(true)
    expect(result.bytes).toBeLessThanOrEqual(maxBytes + fixture.chunks[reads - 1]!)
  })
})

describe('git process limits', () => {
  it('runs a normal command without a limit', async () => {
    const root = await fixtureRepo()

    const result = await runProcess({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: root })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('main')
    expect(result.limit).toBeUndefined()
  })

  it('drops command output when the byte cap is exceeded', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(BIG_BLOB_BYTES))
    const objectId = (await runProcess({ args: ['hash-object', '-w', 'big.txt'], cwd: root }))
      .stdout

    const result = await runProcess({
      args: ['cat-file', '-p', objectId.trim()],
      cwd: root,
      maxOutputBytes: 1024,
    })

    expect(result.limit).toMatchObject({ kind: 'output-limit', maxBytes: 1024, stream: 'stdout' })
    expect(result.stdout).toBe('')
    const observedBytes = result.limit?.kind === 'output-limit' ? result.limit.observedBytes : 0
    expect(observedBytes).toBeGreaterThan(1024)
  })

  it('kills a command that never exits and reports the timeout', async () => {
    const root = await fixtureRepo()
    const startedAt = performance.now()
    const leaderFile = path.join(root, 'one-shot leader file')
    const childFile = path.join(root, 'one-shot child file')
    trackFixturePids([leaderFile, childFile])

    const result = await runProcess({
      args: aliasArgs('hang', inheritedPipeScript('stdout', false)),
      env: fixtureEnv(leaderFile, childFile),
      cwd: root,
      timeoutMs: 300,
    })

    expect(result.limit).toEqual({ kind: 'timeout', timeoutMs: 300 })
    expect(result.exitCode).not.toBe(0)
    expect(performance.now() - startedAt).toBeLessThan(3_000)
  })

  it.for([
    { name: 'timeout', abort: false },
    { name: 'abort', abort: true },
  ])('kills the whole process group on $name', async ({ abort }) => {
    const root = await mkdtemp(path.join(tmpdir(), 'process-group-'))
    roots.push(root)
    const pidFile = path.join(root, 'pid')
    fixturePidFiles.push(pidFile)
    const controller = new AbortController()
    const run = runBoundedProcess({
      argv: [
        'sh',
        '-c',
        '"$FIXTURE_RUNTIME" -e "setInterval(() => {}, 1000)" "$PID_FILE" & echo $! > "$PID_FILE"; wait',
      ],
      cwd: root,
      env: { FIXTURE_RUNTIME: process.execPath, PID_FILE: pidFile },
      timeoutMs: abort ? 10_000 : 300,
      processGroup: true,
      signal: controller.signal,
    })
    await expect.poll(() => readFile(pidFile, 'utf8').catch(() => '')).not.toBe('')
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    expect(await isAlive(pid)).toBe(true)
    if (abort) controller.abort()
    await run.catch(() => undefined)
    await expect.poll(() => isAlive(pid)).toBe(false)
  })

  it('gives network commands the longer default bound', () => {
    expect(defaultTimeoutMs(['fetch'])).toBe(NETWORK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['pull'])).toBe(NETWORK_TIMEOUT_MS)
    // Hooks are user code: a monorepo typecheck in pre-commit outlasts any local limit.
    expect(defaultTimeoutMs(['commit'])).toBe(HOOK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['push'])).toBe(HOOK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['status'])).toBe(LOCAL_TIMEOUT_MS)
    expect(defaultTimeoutMs(['diff'])).toBe(LOCAL_TIMEOUT_MS)
  })
})

describe('streamed git process limits', () => {
  it('streams a normal command without a limit', async () => {
    const root = await fixtureRepo()
    expect(
      await collectStream(
        streamProcess({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: root }),
      ),
    ).toEqual([
      { kind: 'line', line: { stream: 'stdout', text: 'main' } },
      { kind: 'exit', exitCode: 0 },
    ])
  })

  it('keeps an exact UTF-8 output cap successful', async () => {
    const root = await fixtureRepo()

    const events = await collectStream(
      streamProcess({
        args: aliasArgs('emit', 'printf "é\\n"'),
        cwd: root,
        maxOutputBytes: Buffer.byteLength('é\n'),
        timeoutMs: 1_000,
      }),
    )

    expect(events).toEqual([
      { kind: 'line', line: { stream: 'stdout', text: 'é' } },
      { kind: 'exit', exitCode: 0 },
    ])
  })

  it('decodes UTF-8 and final lines across deterministic delivered chunks', async () => {
    const root = await fixtureRepo()
    const originalRead = ReadableStreamDefaultReader.prototype.read
    const tails = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, Uint8Array>()
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read')
    read.mockImplementation(async function (this: ReadableStreamDefaultReader<Uint8Array>) {
      const tail = tails.get(this)
      const result = tail ? { done: false as const, value: tail } : await originalRead.call(this)
      if (result.done || result.value.length <= 1) {
        tails.delete(this)
        return result
      }
      tails.set(this, result.value.subarray(1))
      return { done: false as const, value: result.value.subarray(0, 1) }
    })

    try {
      const events = await collectStream(
        streamProcess({ args: aliasArgs('utf8', 'printf "é\\n末"'), cwd: root, maxOutputBytes: 6 }),
      )
      expect(events).toEqual([
        { kind: 'line', line: { stream: 'stdout', text: 'é' } },
        { kind: 'line', line: { stream: 'stdout', text: '末' } },
        { kind: 'exit', exitCode: 0 },
      ])
      expect(read.mock.calls.length).toBeGreaterThan(6)
    } finally {
      read.mockRestore()
    }
  })

  it.for(['stdout', 'stderr'] as const)('records $0 as the crossing stream', async (stream) => {
    const root = await fixtureRepo()
    const redirect = stream === 'stderr' ? ' >&2' : ''
    const events = await collectStream(
      streamProcess({
        args: aliasArgs('cross', `printf "12345"${redirect}`),
        cwd: root,
        maxOutputBytes: 4,
      }),
    )
    expect(events).toEqual([
      {
        kind: 'exit',
        exitCode: expect.any(Number),
        limit: {
          kind: 'output-limit',
          maxBytes: 4,
          observedBytes: 5,
          stream,
        },
      },
    ])
  })

  it('stops an active producer when the shared output cap is crossed', async () => {
    const root = await fixtureRepo()
    const leaderFile = path.join(root, 'leader file')
    const childFile = path.join(root, 'child file')
    const outcome = await collectWithWatchdog([leaderFile, childFile], () =>
      collectStream(
        streamProcess({
          args: aliasArgs('overflow', activeProducerScript('12345')),
          cwd: root,
          env: fixtureEnv(leaderFile, childFile),
          maxOutputBytes: 4,
          timeoutMs: 5_000,
        }),
      ),
    )

    expect(outcome.kind).toBe('settled')
    if (outcome.kind !== 'settled') return
    expect(outcome.elapsed).toBeLessThan(1_000)
    const terminal = outcome.events.at(-1)
    expect(terminal).toMatchObject({
      kind: 'exit',
      limit: { kind: 'output-limit', maxBytes: 4, stream: 'stdout' },
    })
    if (terminal?.kind === 'exit' && terminal.limit?.kind === 'output-limit')
      expect(terminal.limit.observedBytes).toBeGreaterThan(4)
    expect(outcome.events.filter((event) => event.kind === 'line')).toHaveLength(0)
    await expect.poll(() => fixturePidsAlive([leaderFile, childFile])).toBe(false)
  })

  it('stops a naturally exiting producer after the crossing chunk', async () => {
    const root = await fixtureRepo()

    const events = await collectStream(
      streamProcess({
        args: aliasArgs('overflow', 'printf "12345\\n"'),
        cwd: root,
        maxOutputBytes: 4,
        timeoutMs: 1_000,
      }),
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'exit',
      limit: { kind: 'output-limit', maxBytes: 4, observedBytes: 6, stream: 'stdout' },
    })
  })

  it.for([
    { leaderExits: false, stream: 'stdout' },
    { leaderExits: true, stream: 'stdout' },
    { leaderExits: false, stream: 'stderr' },
    { leaderExits: true, stream: 'stderr' },
  ] as const)(
    'settles an inherited $stream pipe at timeout, leader exited = $leaderExits',
    async ({ leaderExits, stream }) => {
      const root = await fixtureRepo()
      const leaderFile = path.join(root, `${stream} ${leaderExits ? 'exited' : 'leader'} file`)
      const childFile = path.join(root, `${stream} child file`)
      const outcome = await collectWithWatchdog([leaderFile, childFile], () =>
        collectStream(
          streamProcess({
            args: aliasArgs('timeout', inheritedPipeScript(stream, leaderExits)),
            cwd: root,
            env: fixtureEnv(leaderFile, childFile),
            timeoutMs: 100,
          }),
        ),
      )

      expect(outcome.kind).toBe('settled')
      if (outcome.kind !== 'settled') return
      expect(outcome.elapsed).toBeLessThan(1_000)
      expect(outcome.events).toEqual([
        {
          kind: 'exit',
          exitCode: leaderExits ? 0 : expect.any(Number),
          limit: { kind: 'timeout', timeoutMs: 100 },
        },
      ])
      await expect.poll(() => fixturePidsAlive([leaderFile, childFile])).toBe(false)
    },
  )

  it('uses one aggregate budget across stdout and stderr', async () => {
    const root = await fixtureRepo()

    const events = await collectStream(
      streamProcess({
        args: aliasArgs('both', 'printf "out\\n"; printf "err\\n" >&2'),
        cwd: root,
        maxOutputBytes: 7,
        timeoutMs: 1_000,
      }),
    )

    expect(events.at(-1)).toMatchObject({
      kind: 'exit',
      limit: { kind: 'output-limit', maxBytes: 7 },
    })
    const terminal = events.at(-1)
    if (terminal?.kind === 'exit' && terminal.limit?.kind === 'output-limit') {
      expect(['stdout', 'stderr']).toContain(terminal.limit.stream)
      expect(terminal.limit.observedBytes).toBeGreaterThan(7)
    }
  })

  it('cleans owned descendants when the consumer returns after a line', async () => {
    const root = await fixtureRepo()
    const leaderFile = path.join(root, 'early leader file')
    const childFile = path.join(root, 'early child file')
    const outcome = await collectWithWatchdog([leaderFile, childFile], async () => {
      const stream = streamProcess({
        args: aliasArgs('early', activeProducerScript('ready')),
        cwd: root,
        env: fixtureEnv(leaderFile, childFile),
        timeoutMs: 5_000,
      })
      const first = await stream.next()
      await stream.return(undefined)
      return first.done ? [] : [first.value]
    })

    expect(outcome.kind).toBe('settled')
    if (outcome.kind !== 'settled') return
    expect(outcome.events).toEqual([{ kind: 'line', line: { stream: 'stdout', text: 'ready' } }])
    await expect.poll(() => fixturePidsAlive([leaderFile, childFile])).toBe(false)
  })

  it('propagates a pipe reader failure and cleans the other pending reader', async () => {
    const root = await fixtureRepo()
    const leaderFile = path.join(root, 'reader leader file')
    const childFile = path.join(root, 'reader child file')
    const failure = Symbol('fixture reader failure')
    const originalRead = ReadableStreamDefaultReader.prototype.read
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read')
    read.mockImplementationOnce(async function (this: ReadableStreamDefaultReader<Uint8Array>) {
      await originalRead.call(this)
      throw failure
    })
    try {
      const outcome = await collectWithWatchdog([leaderFile, childFile], () =>
        collectStream(
          streamProcess({
            args: aliasArgs('reader-failure', activeProducerScript('ready')),
            cwd: root,
            env: fixtureEnv(leaderFile, childFile),
            timeoutMs: 5_000,
          }),
        ),
      )
      expect(outcome).toMatchObject({ kind: 'rejected', error: failure })
      expect(read).toHaveBeenCalledTimes(2)
      await expect.poll(() => fixturePidsAlive([leaderFile, childFile])).toBe(false)
    } finally {
      read.mockRestore()
    }
  })

  it('preserves a process-start failure', async () => {
    const root = await fixtureRepo()
    const failure = Symbol('fixture spawn failure')
    const spawn = vi.spyOn(Bun, 'spawn').mockImplementationOnce(() => {
      throw failure
    })
    try {
      await expect(collectStream(streamProcess({ args: ['status'], cwd: root }))).rejects.toBe(
        failure,
      )
    } finally {
      spawn.mockRestore()
    }
  })

  it.for(['output-limit', 'timeout'] as const)(
    'releases the repository lane after $0',
    async (limit) => {
      const root = await fixtureRepo()
      const leaderFile = path.join(root, 'lane leader file')
      const childFile = path.join(root, 'lane child file')
      const stream = withGitRepositoryLaneStream(root, () =>
        streamProcess({
          args: aliasArgs(
            'lane',
            limit === 'timeout'
              ? inheritedPipeScript('stdout', false)
              : activeProducerScript('12345'),
          ),
          cwd: root,
          env: fixtureEnv(leaderFile, childFile),
          maxOutputBytes: 4,
          timeoutMs: limit === 'timeout' ? 100 : 5_000,
        }),
      )
      const outcome = await collectWithWatchdog([leaderFile, childFile], () =>
        collectStream(stream),
      )

      expect(outcome.kind).toBe('settled')
      if (outcome.kind !== 'settled') return
      expect(outcome.events.at(-1)).toMatchObject({ kind: 'exit', limit: { kind: limit } })
      await expect(withGitRepositoryLane(root, async () => 'released')).resolves.toBe('released')
    },
  )
})

describe('git service output limit', () => {
  it('bounds aggregate patches while admitting each individual file', async () => {
    const root = await fixtureRepo()
    const files = Array.from({ length: 20 }, (_, index) => `part-${index}.txt`)
    await Promise.all(files.map((file) => writeFile(path.join(root, file), 'a'.repeat(128))))
    await runProcess({ args: ['add', '.'], cwd: root })
    await runProcess({ args: ['commit', '-m', 'many files'], cwd: root })
    await Promise.all(files.map((file) => writeFile(path.join(root, file), 'b'.repeat(128))))
    const service = new GitService(createWorkspacePaths(root), {
      maxCommandOutputBytes: 4096,
      maxDiffFileBytes: () => 128,
    })

    expect((await service.diff('part-0.txt'))[0]?.newText).toHaveLength(128)
    const diff = service.diff('')

    await expect(diff).rejects.toMatchObject({
      code: gitProcessErrors.OUTPUT_LIMIT_EXCEEDED.code,
      message: expect.stringContaining('4608 bytes'),
      status: 413,
    })
  })

  it('leaves a diff below the budget alone', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const service = new GitService(createWorkspacePaths(root), {
      maxCommandOutputBytes: 4096,
    })

    const diffs = await service.diff('')

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.path).toBe('tracked.txt')
  })
})

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform git process '))
  roots.push(root)
  await runProcess({ args: ['init', '-b', 'main'], cwd: root })
  await runProcess({ args: ['config', 'user.email', 'test@example.com'], cwd: root })
  await runProcess({ args: ['config', 'user.name', 'Test User'], cwd: root })
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runProcess({ args: ['add', 'tracked.txt'], cwd: root })
  await runProcess({ args: ['commit', '-m', 'initial'], cwd: root })
  return root
}

function aliasArgs(name: string, script: string) {
  return [
    '-c',
    `alias.${name}=!exec sh -c 'if [ -n "$GIT_FILE" ]; then ps -o ppid= -p $$ > "$GIT_FILE"; fi; ${script}' "$LEADER_FILE"`,
    name,
  ]
}

function fixtureEnv(leaderFile: string, childFile: string) {
  return {
    LEADER_FILE: leaderFile,
    CHILD_FILE: childFile,
    FIXTURE_RUNTIME: process.execPath,
    GIT_FILE: `${leaderFile}.git`,
  }
}

function activeProducerScript(line: '12345' | 'ready') {
  return `"$FIXTURE_RUNTIME" -e "setInterval(() => {}, 1000)" "$CHILD_FILE" & echo $! > "$CHILD_FILE"; echo $$ > "$LEADER_FILE"; printf "${line}\\n"; wait`
}

function inheritedPipeScript(stream: 'stdout' | 'stderr', leaderExits: boolean) {
  const keepOpen = stream === 'stdout' ? '2>/dev/null' : '1>/dev/null'
  const leaderAction = leaderExits ? 'exit 0' : 'wait'

  return `echo $$ > "$LEADER_FILE"; "$FIXTURE_RUNTIME" -e "setInterval(() => {}, 1000)" "$CHILD_FILE" ${keepOpen} & echo $! > "$CHILD_FILE"; ${leaderAction}`
}

async function collectStream(stream: AsyncIterable<GitProcessEvent>) {
  const events: GitProcessEvent[] = []
  for await (const event of stream) events.push(event)

  return events
}

type CollectionOutcome =
  | { kind: 'settled'; events: GitProcessEvent[]; elapsed: number }
  | { kind: 'watchdog'; elapsed: number }
  | { kind: 'rejected'; error: unknown; elapsed: number }

async function collectWithWatchdog(
  pidFiles: readonly string[],
  createCollection: () => Promise<GitProcessEvent[]>,
): Promise<CollectionOutcome> {
  const ownedFiles = trackFixturePids(pidFiles)
  const startedAt = performance.now()
  const collection = createCollection()
  const completion = { settled: false, promise: Promise.resolve<unknown>(undefined) }
  const observed = collection.then(
    (events) => ({ kind: 'settled' as const, events, elapsed: performance.now() - startedAt }),
    (error: unknown) => ({
      kind: 'rejected' as const,
      error,
      elapsed: performance.now() - startedAt,
    }),
  )
  completion.promise = observed.finally(() => {
    completion.settled = true
  })
  fixtureCollections.push(completion)
  const watchdog = Promise.withResolvers<CollectionOutcome>()
  const timer = setTimeout(
    () => watchdog.resolve({ kind: 'watchdog', elapsed: performance.now() - startedAt }),
    3_000,
  )
  const outcome = await Promise.race([observed, watchdog.promise])
  clearTimeout(timer)
  await expect.poll(() => fixturePidsRecorded(ownedFiles), { timeout: 1_000 }).toBe(true)
  if (outcome.kind !== 'watchdog') return outcome

  await killFixturePids(ownedFiles)
  await expect.poll(() => completion.settled, { timeout: 1_000 }).toBe(true)
  await completion.promise
  return outcome
}

function trackFixturePids(pidFiles: readonly string[]) {
  const leaderFile = pidFiles[0]
  const ownedFiles = leaderFile ? pidFiles.concat([`${leaderFile}.git`]) : pidFiles
  fixturePidFiles.push(...ownedFiles)
  return ownedFiles
}

async function fixturePidsRecorded(pidFiles: readonly string[]) {
  const pids = await Promise.all(
    pidFiles.map(async (file) => Number(await readFile(file, 'utf8').catch(() => ''))),
  )
  return pids.every((pid) => Number.isSafeInteger(pid) && pid > 1)
}

async function killFixturePids(pidFiles: readonly string[]) {
  for (const pidFile of pidFiles) {
    const pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
    if (!pid || !(await isAlive(pid))) continue
    const command = await processCommand(pid)
    if (!(await isAlive(pid))) continue
    expect(command).toContain(path.dirname(pidFile))
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      continue
    }
  }
  await expect.poll(() => fixturePidsAlive(pidFiles), { timeout: 1_000 }).toBe(false)
}

async function processCommand(pid: number) {
  const child = Bun.spawn(['ps', '-p', String(pid), '-o', 'args='], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const command = await new Response(child.stdout).text()
  await child.exited
  return command
}

async function fixturePidsAlive(pidFiles: readonly string[]) {
  for (const pidFile of pidFiles) {
    const pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
    if (pid && (await isAlive(pid))) return true
  }

  return false
}

// A killed orphan can linger as a zombie when the container's init does not reap it.
async function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  return stat.split(' ')[2] !== 'Z'
}
