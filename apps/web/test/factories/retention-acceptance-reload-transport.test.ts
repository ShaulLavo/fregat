import { http, passthrough } from 'msw'
import { server as requestInterceptor } from '../msw/server'
import { request as playwrightRequest } from 'playwright'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm, mkdir, readdir, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test, expect } from '../fixtures'
import { createScriptError } from '../../../../scripts/structured-errors'
import {
  createRetentionReloadTransport,
  createRetentionReloadCases,
  createRetentionReloadTimings,
  archiveRetentionReloadFailure,
  archiveRetentionReloadArtifact,
  settleRetentionReloadCleanup,
  createRetentionEntryCapture,
  retentionEntryReceiptLimits,
  retentionEntryBudget,
  retentionEntryReceiptPrefix,
  retentionEntryReceiptTime,
  retentionEntryModulePath,
  observeRetentionEntryEvents,
  retentionEntryErrorCode,
  registerRetentionEntryCapture,
  releaseRetentionEntryCapture,
  beginRetentionEntryCase,
  failRetentionEntryCase,
  endRetentionEntryCase,
  observeRetentionReadiness,
} from './retention-acceptance-reload-transport'

test.each([
  undefined,
  null,
  false,
  0,
  '',
  'ordinary console',
  'RETENTION_READINESS invalid',
  'RETENTION_READINESS null',
])('ignores unavailable or malformed readiness diagnostic %s', (message) => {
  const receipts: unknown[] = []
  observeRetentionReadiness(message, (receipt) => receipts.push(receipt))
  expect(receipts).toEqual([])
})

test('readiness receipts contain only type, boolean, stage and clock fields', () => {
  const receipts: unknown[] = []
  observeRetentionReadiness(
    'RETENTION_READINESS ' +
      JSON.stringify({
        at: 1,
        clock: 'browser',
        privateField: 'discarded fixture value',
        state: {
          stage: 'reload',
          observationType: 'object',
          ready: false,
          privateField: 'discarded fixture value',
        },
      }),
    (receipt) => receipts.push(receipt),
  )
  expect(receipts).toEqual([
    {
      at: 1,
      clock: 'browser',
      state: {
        stage: 'reload',
        observationType: 'object',
        ready: false,
      },
    },
  ])
})

test('contains throwing readiness diagnostic sinks', () => {
  const failure = createScriptError('Controlled diagnostic sink failed', {
    internal: { channel: 'readiness' },
  })
  expect(() =>
    observeRetentionReadiness(
      'RETENTION_READINESS ' +
        JSON.stringify({
          at: 1,
          clock: 'browser',
          state: {
            stage: 'baseline',
            observationType: 'undefined',
            ready: false,
          },
        }),
      () => {
        throw failure
      },
    ),
  ).not.toThrow()
})

function controlRuntime(runtime: string) {
  const name = process.platform === 'win32' ? runtime + '.exe' : runtime
  const candidates = [
    process.execPath,
    ...(process.env.PATH ?? '').split(delimiter).map((directory) => join(directory, name)),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const result = spawnSync(
      candidate,
      ['--eval', 'process.stdout.write(process.versions.bun ? "bun" : "node")'],
      { encoding: 'utf8' },
    )
    if (result.status === 0 && result.stdout === runtime) return candidate
  }
  return null
}

test('caller cancellation alone leaves an old pending forward unsettled', async () => {
  const owner = createRetentionReloadTransport()
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let settled = false
  const operation = owner.run(
    '/pending-source',
    () => waiting,
    async () => {},
  )
  void operation.then(() => {
    settled = true
  })
  await owner.cancelPending()
  await Promise.resolve()
  expect(settled).toBe(false)
  release()
  await owner.drain()
  expect(settled).toBe(true)
})

test.each(['headers', 'source', 'font', 'fulfillment', 'screenshot'])(
  'caller finish closes and settles only its pending %s operation',
  async (phase) => {
    const cases = createRetentionReloadCases()
    const consumer = { sessionId: 'owned-consumer', testPath: 'reload' }
    const id = crypto.randomUUID()
    const owner = createRetentionReloadTransport()
    const primary = createScriptError('Controlled external wait closed', { internal: { phase } })
    let rejectWait = (_error: unknown) => {}
    const waiting = new Promise<void>((_resolve, reject) => {
      rejectWait = reject
    })
    let closes = 0
    let lateWork = 0
    const operation = cases.run(consumer, id, (signal) => {
      signal.addEventListener(
        'abort',
        () => {
          owner.stopAdmission()
          void owner.cancelPending()
        },
        { once: true },
      )
      const forward = owner.run(
        '/controlled-wait',
        async (fulfill) => {
          if (phase === 'fulfillment') await fulfill(() => waiting)
          else await waiting
          lateWork++
        },
        async () => {},
      )
      return {
        result: owner.race(forward).finally(() => owner.drain()),
        close: async () => {
          closes++
          rejectWait(primary)
        },
      }
    })
    const observed = operation.catch((error: unknown) => error)
    await Promise.all([cases.finish(consumer, id), cases.finish(consumer, id)])
    expect(closes).toBe(1)
    expect(lateWork).toBe(0)
    expect(owner.requests[0]?.terminal?.kind).toBe('cancelled')
    expect(owner.requests[0]?.settlement?.kind).toBe('failed')
    expect(cases.activeCount).toBe(0)
    await cases.finish(consumer, id)
    expect(closes).toBe(1)
    await observed
  },
)

test('caller finish preserves a live peer and rejects foreign ownership', async () => {
  const cases = createRetentionReloadCases()
  const owner = { sessionId: 'one', testPath: 'reload' }
  const peer = { sessionId: 'two', testPath: 'reload' }
  const id = crypto.randomUUID()
  const peerId = crypto.randomUUID()
  let release = () => {}
  let peerRelease = () => {}
  let closed = 0
  let peerClosed = 0
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const peerWaiting = new Promise<void>((resolve) => {
    peerRelease = resolve
  })
  const operation = cases.run(owner, id, () => ({
    result: waiting,
    close: async () => {
      closed++
      release()
    },
  }))
  const other = cases.run(peer, peerId, () => ({
    result: peerWaiting,
    close: async () => {
      peerClosed++
      peerRelease()
    },
  }))
  expect(() => cases.finish(peer, id)).toThrow()
  await cases.finish(owner, id)
  await operation
  expect(closed).toBe(1)
  expect(peerClosed).toBe(0)
  expect(cases.activeCount).toBe(1)
  await cases.finish(peer, peerId)
  await other
  expect(peerClosed).toBe(1)
  expect(cases.activeCount).toBe(0)
})

test('caller lifecycle preserves primary failure and qualifies secondary cleanup', async () => {
  const cases = createRetentionReloadCases()
  const owner = { sessionId: 'failure', testPath: 'reload' }
  const id = crypto.randomUUID()
  const primary = createScriptError('Controlled reload failed', {
    internal: { phase: 'operation' },
  })
  const secondary = createScriptError('Controlled close failed', { internal: { phase: 'close' } })
  let closes = 0
  const operation = cases.run(owner, id, () => ({
    result: Promise.reject(primary),
    close: async () => {
      closes++
      throw secondary
    },
  }))
  await expect(operation).rejects.toBe(primary)
  await expect(cases.finish(owner, id)).rejects.toBeDefined()
  expect(closes).toBe(1)
  expect(cases.activeCount).toBe(0)
  await cases.finish(owner, id)
})

test.each(['fulfilled', 'rejected'])(
  'caller finish joins an independent %s main body after a separate fatal forward',
  async (settlement) => {
    const cases = createRetentionReloadCases()
    const owner = { sessionId: 'independent-main', testPath: 'reload' }
    const id = crypto.randomUUID()
    const transport = createRetentionReloadTransport()
    const primary = createScriptError('Controlled separate forward failed', {
      internal: { phase: 'forward' },
    })
    const secondary = createScriptError('Controlled independent main failed', {
      internal: { phase: 'main-body' },
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let mainSettled = false
    let finished = false
    let lateWork = 0
    let closes = 0
    let closed: Promise<void> | null = null
    const close = () =>
      (closed ??= Promise.resolve().then(() => {
        closes++
      }))
    let cleanup: Awaited<ReturnType<typeof settleRetentionReloadCleanup>> = []
    const result = cases.run(owner, id, () => {
      const main = gate.then(() => {
        if (finished) lateWork++
        mainSettled = true
        if (settlement === 'rejected') throw secondary
      })
      void transport.run(
        '/fatal-forward',
        async () => {
          throw primary
        },
        async () => {},
      )
      const performed = (async () => {
        let failure: unknown
        try {
          await transport.race(main)
        } catch (error) {
          failure = error
        }
        cleanup = await settleRetentionReloadCleanup(
          [
            { stage: 'stop', run: async () => transport.stopAdmission() },
            { stage: 'cancel', run: () => transport.cancelPending() },
            { stage: 'close-context', run: close },
            { stage: 'drain-routes', run: () => transport.drain() },
          ],
          main,
        )
        throw failure
      })()
      return { result: performed, close }
    })
    const observedPrimary = result.catch((error: unknown) => error)
    const finishing = cases.finish(owner, id).then(() => {
      finished = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finished).toBe(false)
    expect(mainSettled).toBe(false)
    expect(cases.activeCount).toBe(1)
    expect(closes).toBe(1)
    release()
    await finishing
    expect(await observedPrimary).toBe(primary)
    expect(mainSettled).toBe(true)
    expect(lateWork).toBe(0)
    expect(cases.activeCount).toBe(0)
    expect(closes).toBe(1)
    expect(cleanup.find((outcome) => outcome.stage === 'join-main-operation')?.error).toBe(
      settlement === 'rejected' ? secondary : null,
    )
  },
)

test('normal caller completion closes once and timing stays in the existing case cell', async () => {
  const cases = createRetentionReloadCases()
  const owner = { sessionId: 'normal', testPath: 'reload' }
  const id = crypto.randomUUID()
  let closes = 0
  const operation = cases.run(owner, id, () => ({
    result: Promise.resolve('ready'),
    close: async () => {
      closes++
    },
  }))
  await expect(operation).resolves.toBe('ready')
  await cases.finish(owner, id)
  expect(closes).toBe(1)
  const timings = createRetentionReloadTimings()
  expect(timings.reloadLoadedAt).toBeNull()
  const capture = createRetentionEntryCapture()
  capture.begin('/timing-cell', timings)
  const initial = capture.inspect()
  const transport = createRetentionReloadTransport(undefined, timings)
  await transport.run(
    '/first',
    async (_fulfill, headersCompleted) => {
      headersCompleted()
    },
    async () => {},
  )
  await transport.run(
    '/second',
    async (_fulfill, headersCompleted) => {
      headersCompleted()
    },
    async () => {},
  )
  timings.baselineReadyAt = Number.MAX_SAFE_INTEGER
  timings.reloadLoadedAt = Number.MAX_SAFE_INTEGER
  timings.reloadReadyAt = Number.MAX_SAFE_INTEGER
  timings.fontReadyAt = Number.MAX_SAFE_INTEGER
  timings.screenshotCompleteAt = Number.MAX_SAFE_INTEGER
  timings.browserTimeOrigin = Number.MAX_SAFE_INTEGER
  expect(timings.headersCompleted?.requestId).toBe(2)
  timings.headersCompleted = {
    requestId: Number.MAX_SAFE_INTEGER,
    at: Number.MAX_SAFE_INTEGER,
  }
  expect(Buffer.byteLength(JSON.stringify(timings))).toBeLessThan(
    retentionEntryReceiptLimits.recordBytes,
  )
  expect(capture.inspect().retainedBytes).toBe(initial.retainedBytes)
  expect(capture.inspect().retainedRecords).toBe(initial.retainedRecords)
  expect(initial.retainedBytes).toBeLessThanOrEqual(retentionEntryReceiptLimits.bytes)
  capture.end('/timing-cell')
  capture.dispose()
})

test.for([false, true])('entry archives preserve optional timing facts $0', async (withTimings) => {
  const output = await mkdtemp(join(tmpdir(), 'retention-entry-timing-'))
  const capture = createRetentionEntryCapture()
  const timings = withTimings ? createRetentionReloadTimings() : undefined
  if (timings) {
    timings.headersCompleted = { requestId: 7, at: 13 }
    timings.baselineReadyAt = 17
    timings.reloadLoadedAt = 18
    timings.reloadReadyAt = 19
    timings.fontReadyAt = 23
    timings.screenshotCompleteAt = 29
    timings.browserTimeOrigin = 31
  }
  const frozenTimings = timings && { ...timings }
  try {
    capture.begin(output, timings)
    expect(await capture.fail(output, 'reload')).toEqual({ status: 'written', codes: [] })
    if (timings) {
      timings.reloadLoadedAt = 41
      timings.screenshotCompleteAt = 37
    }
    capture.end(output)
    expect(await capture.persistFailures()).toEqual([{ status: 'written', codes: [] }])
    for (const name of ['entry-transport.frozen.json', 'entry-transport.json']) {
      const packet: unknown = JSON.parse(await readFile(join(output, name), 'utf8'))
      expect(packet).toMatchObject({ version: 2, phase: 'reload' })
      if (withTimings) expect(packet).toHaveProperty('timings', frozenTimings)
      if (!withTimings) expect(packet).not.toHaveProperty('timings')
    }
    expect((await readdir(output)).sort()).toEqual([
      'entry-transport.frozen.json',
      'entry-transport.json',
    ])
  } finally {
    capture.dispose()
    await rm(output, { recursive: true, force: true })
  }
})

test('socket reset fails the owning reload command, retains raw evidence, and attempts every cleanup', async ({
  annotate,
}) => {
  const output = await mkdtemp(join(tmpdir(), 'retention-reload-transport-control-'))
  let requests = 0
  const server = createServer((request) => {
    requests += 1
    request.socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  expect(address).not.toBeNull()
  if (!address || typeof address === 'string') return
  const url = `http://127.0.0.1:${address.port}/src/features/chat/state/chat-message-intents.ts`
  requestInterceptor.use(http.get(url, () => passthrough()))
  const client = await playwrightRequest.newContext()
  const owner = createRetentionReloadTransport()
  let aborted = false
  const route = owner.run(
    url,
    async () => {
      await client.get(url, { maxRetries: 0 })
    },
    async () => {
      aborted = true
    },
  )
  const command = owner.race(new Promise<never>(() => {}))
  const currentFrames = [{ at: 1, kind: 'current', source: 'retained control frame' }]
  let commandError: unknown
  try {
    await command
    expect.unreachable('The reset must fail the owning command')
  } catch (error) {
    commandError = error
    await archiveRetentionReloadFailure(output, {
      phase: 'entry',
      frames: currentFrames,
      transportFailures: owner.failures,
      failure: error instanceof Error ? error.message : String(error),
    })
  } finally {
    const attempted: string[] = []
    const cleanup = await settleRetentionReloadCleanup([
      {
        stage: 'drain-routes',
        run: async () => {
          attempted.push('drain-routes')
          await route
          throw commandError
        },
      },
      {
        stage: 'unroute',
        run: async () => {
          attempted.push('unroute')
        },
      },
      {
        stage: 'close-context',
        run: async () => {
          attempted.push('close-context')
        },
      },
    ])
    try {
      expect(commandError).toBe(owner.firstError)
      expect(owner.failures).toHaveLength(1)
      expect(owner.failures[0]).toMatchObject({ url, stage: 'forward' })
      expect(owner.failures[0]?.error).toMatch(/ECONNRESET|socket hang up/)
      expect(requests).toBe(1)
      expect(aborted).toBe(true)
      expect(attempted).toEqual(['drain-routes', 'unroute', 'close-context'])
      expect(cleanup[0]?.error).toBe(commandError)
      expect(cleanup.slice(1).map((outcome) => outcome.error)).toEqual([null, null])
      const raw: unknown = JSON.parse(await readFile(join(output, 'failed-raw.json'), 'utf8'))
      await annotate(
        JSON.stringify({
          raw,
          requests,
          aborted,
          cleanup: cleanup.map((outcome) => ({
            stage: outcome.stage,
            at: outcome.at,
            error: outcome.error instanceof Error ? outcome.error.message : outcome.error,
          })),
          observedFailure: owner.failures[0],
        }),
        'retention-reset-boundary-control',
      )
      expect(raw).toMatchObject({
        phase: 'entry',
        frames: currentFrames,
        transportFailures: owner.failures,
      })
    } finally {
      await client.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(output, { recursive: true, force: true })
    }
  }
})

test.for(['failed-raw.json', 'cleanup.json'] as const)(
  'artifact write failure retains an untruncated fallback for %s',
  async (name, { annotate }) => {
    const output = await mkdtemp(join(tmpdir(), 'retention-reload-writer-control-'))
    const frames = Array.from({ length: 150 }, (_, sequence) => ({
      sequence,
      text: 'synthetic packet '.repeat(100),
    }))
    const payload = { classification: 'synthetic archive packet', frames }
    try {
      await mkdir(join(output, name))
      const failures = await archiveRetentionReloadArtifact(output, name, payload)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({ code: 'EISDIR' })
      const fallback = await readFile(join(output, name + '.fallback.txt'), 'utf8')
      expect(fallback).toContain('sequence: 149')
      expect(fallback).toContain(frames[149]?.text)
      expect(fallback).not.toContain('more items')
      await annotate(
        JSON.stringify({ name, failures: failures.map(String), fallback }),
        'retention-writer-boundary-control',
      )
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('serialization and fallback failures remain separate recorded outcomes', async ({
  annotate,
}) => {
  const output = await mkdtemp(join(tmpdir(), 'retention-reload-serialization-control-'))
  const payload: { classification: string; self?: unknown } = {
    classification: 'synthetic circular packet',
  }
  payload.self = payload
  try {
    const serialization = await archiveRetentionReloadFailure(output, payload)
    expect(serialization).toHaveLength(1)
    const fallback = await readFile(join(output, 'failed-raw.json.fallback.txt'), 'utf8')
    expect(fallback).toContain('synthetic circular packet')
    expect(fallback).toContain('[Circular')
    await rm(join(output, 'failed-raw.json.fallback.txt'))
    await mkdir(join(output, 'failed-raw.json.fallback.txt'))
    const unavailable = await archiveRetentionReloadFailure(output, payload)
    expect(unavailable).toHaveLength(2)
    expect(unavailable[1]).toMatchObject({ code: 'EISDIR' })
    await annotate(
      JSON.stringify({
        serialization: serialization.map(String),
        fallback,
        unavailable: unavailable.map(String),
        fallbackPersisted: false,
      }),
      'retention-serialization-boundary-control',
    )
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.for([false, true])(
  'pending forward settles after owned cancellation despite rejection $0',
  async (rejectCancellation, { annotate }) => {
    const output = await mkdtemp(join(tmpdir(), 'retention-reload-pending-control-'))
    let arrived: () => void = () => {}
    let closed: () => void = () => {}
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const socketClosed = new Promise<void>((resolve) => {
      closed = resolve
    })
    let requests = 0
    const server = createServer((request) => {
      requests += 1
      request.socket.on('close', closed)
      arrived()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    expect(address).not.toBeNull()
    if (!address || typeof address === 'string') return
    const url = `http://127.0.0.1:${address.port}/pending-forward`
    requestInterceptor.use(http.get(url, () => passthrough()))
    const client = await playwrightRequest.newContext()
    const owner = createRetentionReloadTransport()
    let aborted = false
    const task = owner.run(
      url,
      async () => {
        await client.get(url, { maxRetries: 0 })
      },
      async () => {
        aborted = true
      },
    )
    const command = owner.race(Promise.resolve('successful operation'))
    try {
      await requestArrived
      owner.beginRestoration()
      owner.stopAdmission()
      const cleanup = await settleRetentionReloadCleanup([
        {
          stage: 'cancel-forwarding',
          run: async () => {
            await owner.cancelPending()
            if (rejectCancellation) JSON.parse('controlled cancellation failure')
            await client.dispose()
          },
        },
        { stage: 'unroute', run: async () => {} },
        {
          stage: 'archive-final-frames',
          run: () =>
            archiveRetentionReloadFailure(output, {
              classification: 'pending control packet',
              failures: owner.failures,
            }),
        },
        { stage: 'close-context', run: () => client.dispose() },
        { stage: 'drain-routes', run: () => owner.drain() },
      ])
      await socketClosed
      await task
      expect(await command).toBe('successful operation')
      expect(owner.hasFailure).toBe(false)
      expect(owner.requests[0]?.terminal?.kind).toBe('cancelled')
      expect(owner.failures[0]?.stage).toBe('settled-after-owned-cancellation')
      expect(requests).toBe(1)
      expect(aborted).toBe(true)
      expect(cleanup.map((outcome) => outcome.stage)).toEqual([
        'cancel-forwarding',
        'unroute',
        'archive-final-frames',
        'close-context',
        'drain-routes',
      ])
      if (rejectCancellation) expect(cleanup[0]?.error).toBeInstanceOf(SyntaxError)
      if (!rejectCancellation) expect(cleanup[0]?.error).toBeNull()
      expect(cleanup.slice(1).map((outcome) => outcome.error)).toEqual([null, null, null, null])
      const raw: unknown = JSON.parse(await readFile(join(output, 'failed-raw.json'), 'utf8'))
      expect(raw).toMatchObject({ classification: 'pending control packet' })
      await archiveRetentionReloadArtifact(output, 'cleanup.json', {
        failures: owner.failures,
        cleanup: cleanup.map((outcome) => ({ stage: outcome.stage, error: String(outcome.error) })),
      })
      const settledRaw: unknown = JSON.parse(await readFile(join(output, 'cleanup.json'), 'utf8'))
      expect(settledRaw).toMatchObject({ failures: owner.failures })
      await annotate(
        JSON.stringify({
          requests,
          aborted,
          externalRescueUsed: false,
          socketClosed: true,
          cleanup,
          raw,
          settledRaw,
        }),
        'retention-pending-boundary-control',
      )
    } finally {
      await client.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['success', 'failure'] as const)(
  'restoration forwards a new live request with outcome $0',
  async (mode, { annotate }) => {
    let requests = 0
    const server = createServer((request, response) => {
      requests += 1
      if (mode === 'failure') {
        request.socket.destroy()
        return
      }
      response.end('controlled restoration reply')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    expect(address).not.toBeNull()
    if (!address || typeof address === 'string') return
    const url = `http://127.0.0.1:${address.port}/restoration-request`
    requestInterceptor.use(http.get(url, () => passthrough()))
    const client = await playwrightRequest.newContext()
    const owner = createRetentionReloadTransport()
    expect(await owner.race(Promise.resolve('operation complete'))).toBe('operation complete')
    try {
      owner.beginRestoration()
      await owner.run(
        url,
        async () => {
          await client.get(url, { maxRetries: 0 })
        },
        async () => {},
      )
      expect(requests).toBe(1)
      expect(owner.requests[0]?.phase).toBe('restoration')
      expect(owner.hasFailure).toBe(mode === 'failure')
      if (mode === 'failure') {
        const error = await owner
          .race(new Promise<never>(() => {}))
          .catch((value: unknown) => value)
        expect(error).toBe(owner.firstError)
        expect(owner.requests[0]?.terminal?.kind).toBe('failed')
      }
      owner.stopAdmission()
      await owner.cancelPending()
      await client.dispose()
      let invoked = false
      await owner.run(
        url,
        async () => {
          invoked = true
          await client.get(url, { maxRetries: 0 })
        },
        async () => {},
      )
      await owner.drain()
      expect(invoked).toBe(false)
      expect(requests).toBe(1)
      expect(owner.requests[1]).toMatchObject({
        operationInvoked: false,
        terminal: { kind: 'cancelled' },
        settlement: { kind: 'not-started' },
      })
      await annotate(
        JSON.stringify({
          mode,
          requests,
          closedAdmissionInvokedFetch: invoked,
          observations: owner.requests,
          failures: owner.failures,
          hasFailure: owner.hasFailure,
        }),
        'retention-restoration-owner-control',
      )
    } finally {
      await client.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

test('a genuine rejection wins its request before owned cancellation', async () => {
  const owner = createRetentionReloadTransport()
  const error = await Promise.resolve()
    .then(() => JSON.parse('controlled genuine failure'))
    .catch((value: unknown) => value)
  const request = owner.run(
    'controlled-preexisting-rejection',
    () => Promise.reject(error),
    async () => {},
  )
  owner.stopAdmission()
  await owner.cancelPending()
  await request
  expect(owner.hasFailure).toBe(true)
  expect(owner.firstError).toBe(error)
  expect(owner.requests[0]?.terminal?.kind).toBe('failed')
})

test('a real fetch error after admission closes still wins before request cancellation', async () => {
  let arrived: () => void = () => {}
  let failRequest: () => void = () => {}
  const accepted = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const server = createServer((request) => {
    failRequest = () => request.socket.destroy()
    arrived()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  expect(address).not.toBeNull()
  if (!address || typeof address === 'string') return
  const url = `http://127.0.0.1:${address.port}/genuine-closing-failure`
  requestInterceptor.use(http.get(url, () => passthrough()))
  const client = await playwrightRequest.newContext()
  const owner = createRetentionReloadTransport()
  const task = owner.run(
    url,
    async () => {
      await client.get(url, { maxRetries: 0 })
    },
    async () => {},
  )
  const command = owner.race(new Promise<never>(() => {})).catch((error: unknown) => error)
  try {
    await accepted
    owner.stopAdmission()
    failRequest()
    const error = await command
    await owner.cancelPending()
    await task
    expect(owner.hasFailure).toBe(true)
    expect(owner.firstError).toBe(error)
    expect(owner.requests[0]?.terminal?.kind).toBe('failed')
    expect(owner.failures[0]?.stage).toBe('forward')
  } finally {
    await client.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.for(['abort-pending', 'abort-rejected', 'fulfill-pending'] as const)(
  'terminal action $0 leaves disposal and context close reachable before joining',
  async (mode, { annotate }) => {
    const owner = createRetentionReloadTransport()
    const operation = Promise.withResolvers<void>()
    const acknowledgement = Promise.withResolvers<void>()
    const actionStarted = Promise.withResolvers<void>()
    const actionError = await Promise.resolve()
      .then(() => JSON.parse('controlled external terminal action rejection'))
      .catch((error: unknown) => error)
    const calls: string[] = []
    const action = () => {
      calls.push(mode.startsWith('fulfill') ? 'fulfill' : 'abort')
      actionStarted.resolve()
      if (mode === 'abort-rejected') return Promise.reject(actionError)
      return acknowledgement.promise
    }
    const task = owner.run(
      'synthetic-terminal-action-boundary',
      async (fulfill) => {
        if (mode === 'fulfill-pending') {
          await fulfill(action)
          return
        }
        await operation.promise
        await fulfill(async () => {
          calls.push('late-fulfill')
        })
      },
      action,
    )
    if (mode === 'fulfill-pending') await actionStarted.promise
    owner.stopAdmission()
    const cleanup = await settleRetentionReloadCleanup([
      { stage: 'cancel-forwarding', run: () => owner.cancelPending() },
      {
        stage: 'dispose-forward-context',
        run: async () => {
          calls.push('dispose')
          expect(owner.needsContextClose).toBe(true)
          if (mode === 'abort-rejected') throw actionError
        },
      },
      {
        stage: 'fallback-context-close',
        run: async () => {
          calls.push('close')
          operation.resolve()
          acknowledgement.resolve()
        },
      },
      {
        stage: 'drain-routes',
        run: async () => {
          calls.push('drain')
          await owner.drain()
        },
      },
      { stage: 'unroute', run: async () => calls.push('unroute') },
    ])
    await task
    expect(calls).toEqual([
      mode === 'fulfill-pending' ? 'fulfill' : 'abort',
      'dispose',
      'close',
      'drain',
      'unroute',
    ])
    expect(owner.requests[0]).toMatchObject({
      requestId: 1,
      terminal: { kind: 'cancelled' },
      settlement: { kind: 'succeeded' },
      action: { kind: mode === 'fulfill-pending' ? 'fulfill' : 'abort' },
    })
    expect(owner.requests[0]?.action?.settledAt).toBeTypeOf('number')
    expect(owner.hasFailure).toBe(false)
    if (mode !== 'fulfill-pending') expect(owner.requests[0]?.skippedActions).toContain('fulfill')
    if (mode === 'abort-rejected') {
      expect(cleanup[1]?.error).toBe(actionError)
      expect(cleanup[3]?.error).toBe(actionError)
      expect(owner.failures[0]).toMatchObject({ requestId: 1, stage: 'route-action-abort' })
    }
    await annotate(
      JSON.stringify({
        mode,
        boundary: 'synthetic external terminal actions, no native Route claim',
        calls,
        requests: owner.requests,
        failures: owner.failures,
        cleanup: cleanup.map(({ stage, error }) => ({ stage, error: String(error) })),
      }),
      'retention-terminal-action-control',
    )
  },
)

test('failed entry receipt reads back its linked request, predecessor, lifetime and post-stop tail', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-entry-receipt-'))
  const origin = 'http://127.0.0.1:1'
  const capture = createRetentionEntryCapture()
  const time = retentionEntryReceiptTime()
  registerRetentionEntryCapture(origin, capture)
  try {
    capture.accept({ ...time, kind: 'process-start', childPid: 99 })
    capture.accept({
      ...time,
      kind: 'installed',
      port: 1,
      keepAliveTimeout: 5,
      headersTimeout: 6,
      requestTimeout: 7,
      maxRequestsPerSocket: 0,
    })
    capture.accept({ ...time, kind: 'listening', port: 1 })
    capture.accept({
      ...time,
      kind: 'response-finish',
      requestId: 1,
      socketId: 1,
      path: '/apps/web/src/module.ts',
      status: 200,
      complete: true,
    })
    beginRetentionEntryCase(origin, output)
    capture.accept({
      ...time,
      kind: 'request',
      requestId: 2,
      socketId: 2,
      path: '/apps/web/src/module.ts',
      method: 'GET',
    })
    failRetentionEntryCase(origin, output, 'baseline-ready', [
      {
        requestId: 73,
        url: 'http://localhost/src/module.ts?private-query=secret#private-fragment',
      },
    ])
    capture.accept({ ...time, kind: 'socket-close', socketId: 2 })
    endRetentionEntryCase(origin, output)
    capture.accept({ ...time, kind: 'process-stop', childPid: 99, signal: 'SIGTERM' })
    capture.accept({ ...time, kind: 'process-exit', childPid: 99, exitCode: 0, signal: null })
    expect(await capture.persistFailures()).toEqual([{ status: 'written', codes: [] }])
    const text = await readFile(join(output, 'entry-transport.json'), 'utf8')
    const packet: unknown = JSON.parse(text)
    expect(packet).toMatchObject({
      version: 2,
      availability: 'observed',
      missingFacts: [],
      phase: 'baseline-ready',
      endedAt: expect.any(Number),
      refused: 0,
      dropped: 0,
      sameModulePredecessors: [{ kind: 'response-finish', requestId: 1, status: 200 }],
      failureWindow: [
        { kind: 'request', requestId: 2 },
        { kind: 'route-failure', transportRequestId: 73, path: '/apps/web/src/module.ts' },
      ],
      postFailureTail: [
        { kind: 'socket-close', socketId: 2 },
        { kind: 'process-stop', signal: 'SIGTERM' },
        { kind: 'process-exit', exitCode: 0 },
      ],
    })
    expect(text).not.toMatch(/private-query|secret|private-fragment|localhost/)
    expect((await readdir(output)).sort()).toEqual([
      'entry-transport.frozen.json',
      'entry-transport.json',
    ])
  } finally {
    releaseRetentionEntryCapture(origin)
    await rm(output, { recursive: true, force: true })
  }
})

test('passing entry cases persist no receipt and missing facts remain explicit', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-entry-missing-'))
  const capture = createRetentionEntryCapture()
  try {
    capture.begin(output)
    capture.accept({ ...retentionEntryReceiptTime(), kind: 'socket-timeout', socketId: 1 })
    capture.end(output)
    expect(await capture.persistFailures()).toEqual([])
    expect(await readdir(output)).toEqual([])
    capture.begin(output)
    capture.fail(output, 'entry')
    capture.end(output)
    await capture.persistFailures()
    const packet: unknown = JSON.parse(await readFile(join(output, 'entry-transport.json'), 'utf8'))
    expect(packet).toMatchObject({
      availability: 'partial',
      missingFacts: ['installed', 'listening', 'process-start'],
      failureWindow: [],
      postFailureTail: [],
    })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('stdout fragments retain valid metadata and pass ordinary output without retaining diagnostic text', () => {
  const capture = createRetentionEntryCapture()
  const ordinary: string[] = []
  const packet =
    retentionEntryReceiptPrefix +
    JSON.stringify(
      entryControlFrame({
        ...retentionEntryReceiptTime(),
        kind: 'request',
        requestId: 1,
        socketId: 1,
        method: 'GET',
        path: '/apps/web/src/שלום.ts',
      }),
    ) +
    '\n'
  const input = Buffer.from('ordinary startup\n' + packet + 'ordinary tail\n')
  for (let index = 0; index < input.length; index++)
    capture.read(input.subarray(index, index + 1), (value) => ordinary.push(value))
  expect(ordinary.join('')).toBe('ordinary startup\nordinary tail\n')
  expect(capture.inspect()).toMatchObject({ refused: 0, retainedRecords: 16072 })
  capture.read(Buffer.from(retentionEntryReceiptPrefix + '{broken}\n'))
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix + 'x'.repeat(retentionEntryReceiptLimits.recordBytes + 1) + '\n',
    ),
  )
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix +
        JSON.stringify(
          entryControlFrame(
            { ...retentionEntryReceiptTime(), kind: 'socket-close', socketId: 1 },
            2,
          ),
        ) +
        '\n',
    ),
  )
  expect(capture.inspect()).toMatchObject({ refused: 2, retainedRecords: 16073 })
  capture.read(Buffer.from(retentionEntryReceiptPrefix + '{'))
  capture.finishWire()
  expect(capture.inspect()).toMatchObject({
    refused: 3,
    wireEndObserved: true,
    pendingWireBytes: 0,
  })
  expect(() =>
    capture.read(Buffer.from('ordinary callback\n'), () => {
      JSON.parse('secondary callback fault')
    }),
  ).not.toThrow()
  expect(capture.inspect().refused).toBe(4)
})

test('unknown, private, oversized and throwing metadata is refused without values in the receipt', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-entry-refusal-'))
  const capture = createRetentionEntryCapture()
  const time = retentionEntryReceiptTime()
  try {
    capture.begin(output)
    for (const extra of [
      'headers',
      'authorization',
      'body',
      'source',
      'env',
      'settings',
      'message',
    ])
      capture.accept({ ...time, kind: 'socket-close', socketId: 1, [extra]: 'private-sentinel' })
    for (const path of [
      '/src.ts?private-sentinel',
      '/src.ts#private-sentinel',
      '/src/../private-sentinel',
      '/src\\private-sentinel',
      '/' + 'x'.repeat(retentionEntryReceiptLimits.pathBytes),
      '/src/\u0000private-sentinel',
    ])
      capture.accept({ ...time, kind: 'request', requestId: 1, socketId: 1, method: 'GET', path })
    capture.accept({ ...time, kind: 'unknown', value: 'private-sentinel' })
    capture.accept({
      get kind() {
        return JSON.parse('private-sentinel')
      },
    })
    capture.accept({ ...time, kind: 'server-error', code: 'private-sentinel' })
    capture.fail(output, 'entry')
    await capture.persistFailures()
    const text = await readFile(join(output, 'entry-transport.json'), 'utf8')
    expect(text).not.toContain('private-sentinel')
    expect(JSON.parse(text)).toMatchObject({ refused: 16, failureWindow: [] })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('module normalization strips query and fragments and refuses outside-root and credential paths', () => {
  const root = join(tmpdir(), 'retention-entry-root')
  expect(retentionEntryModulePath(root, '/src/module.ts?token=private#private')).toBe(
    '/apps/web/src/module.ts',
  )
  expect(retentionEntryModulePath(root, '/@fs' + join(root, 'packages/module.ts'))).toBe(
    '/packages/module.ts',
  )
  expect(
    retentionEntryModulePath(root, '/@fs' + join(tmpdir(), 'outside-root/module.ts')),
  ).toBeNull()
  expect(retentionEntryModulePath(root, 'http://private:secret@localhost/src/module.ts')).toBeNull()
  expect(retentionEntryModulePath(root, '/src/%3Fprivate')).toBeNull()
  expect(retentionEntryModulePath(root, '/src/%ZZ')).toBeNull()
})

test.for(['records', 'bytes'] as const)(
  'entry capture bounds %s and keeps a frozen failure after later overflow',
  async (bound) => {
    const output = await mkdtemp(join(tmpdir(), 'retention-entry-bounds-'))
    const capture = createRetentionEntryCapture()
    const time = retentionEntryReceiptTime()
    try {
      capture.accept({
        ...time,
        kind: 'installed',
        port: 1,
        keepAliveTimeout: 5,
        headersTimeout: 6,
        requestTimeout: 7,
        maxRequestsPerSocket: 0,
      })
      capture.begin(output)
      capture.accept({ ...time, kind: 'socket-error', socketId: 73, code: 'ECONNRESET' })
      capture.fail(output, 'reload')
      const path = bound === 'bytes' ? '/' + 'x'.repeat(1000) : '/module.ts'
      for (let id = 0; id <= retentionEntryReceiptLimits.records; id++)
        capture.accept({
          ...time,
          kind: 'request',
          requestId: id,
          socketId: 1,
          method: 'GET',
          path,
        })
      const facts = capture.inspect()
      expect(facts.retainedRecords).toBeLessThanOrEqual(retentionEntryReceiptLimits.records)
      expect(facts.retainedBytes).toBeLessThanOrEqual(retentionEntryReceiptLimits.bytes)
      expect(facts.dropped).toBeGreaterThan(0)
      capture.accept({ ...time, kind: 'process-stop', childPid: 99, signal: 'SIGTERM' })
      capture.accept({ ...time, kind: 'process-stop', childPid: 99, signal: 'SIGKILL' })
      capture.accept({
        ...time,
        kind: 'process-exit',
        childPid: 99,
        exitCode: null,
        signal: 'SIGKILL',
      })
      capture.end(output)
      await capture.persistFailures()
      const packet: unknown = JSON.parse(
        await readFile(join(output, 'entry-transport.json'), 'utf8'),
      )
      expect(packet).toMatchObject({
        lifetimeBeforeFailure: [{ kind: 'installed' }],
        failureWindow: [{ kind: 'socket-error', socketId: 73, code: 'ECONNRESET' }],
        dropped: expect.any(Number),
        truncated: true,
        postFailureTail: expect.arrayContaining([
          { ...time, kind: 'process-stop', childPid: 99, signal: 'SIGTERM' },
          { ...time, kind: 'process-stop', childPid: 99, signal: 'SIGKILL' },
          { ...time, kind: 'process-exit', childPid: 99, exitCode: null, signal: 'SIGKILL' },
        ]),
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['fallback', 'unavailable', 'missing-directory'] as const)(
  'entry persistence %s stays secondary to the same Error and every cleanup',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'retention-entry-io-'))
    const capture = createRetentionEntryCapture()
    const owner = createRetentionReloadTransport()
    const original = await Promise.resolve()
      .then(() => JSON.parse('external primary failure'))
      .catch((error: unknown) => error)
    const attempts: string[] = []
    const target = mode === 'missing-directory' ? join(output, 'absent') : output
    const route = owner.run(
      'external-control',
      () => Promise.reject(original),
      async () => {},
    )
    const command = owner.race(new Promise<never>(() => {}))
    void command.catch(() => {})
    capture.begin(target)
    try {
      if (mode !== 'missing-directory') await mkdir(join(output, 'entry-transport.json'))
      if (mode === 'unavailable') await mkdir(join(output, 'entry-transport.json.fallback.txt'))
      let observed: unknown
      try {
        await command
      } catch (error) {
        observed = error
        capture.fail(target, 'entry')
      }
      const cleanup = await settleRetentionReloadCleanup([
        {
          stage: 'join',
          run: async () => {
            attempts.push('join')
            await route
          },
        },
        {
          stage: 'raw',
          run: async () => {
            attempts.push('raw')
            await archiveRetentionReloadFailure(output, {
              frames: [{ at: 1 }],
              failure: 'external primary failure',
            })
          },
        },
        {
          stage: 'final',
          run: async () => {
            attempts.push('final')
            await archiveRetentionReloadArtifact(output, 'final-raw.json', { frames: [{ at: 2 }] })
          },
        },
        {
          stage: 'close',
          run: async () => {
            attempts.push('close')
          },
        },
      ])
      capture.end(target)
      const receipts = await capture.persistFailures()
      expect(observed).toBe(original)
      expect(owner.firstError).toBe(original)
      expect(attempts).toEqual(['join', 'raw', 'final', 'close'])
      expect(cleanup.map((outcome) => outcome.error)).toEqual([null, null, null, null])
      expect(JSON.parse(await readFile(join(output, 'failed-raw.json'), 'utf8'))).toMatchObject({
        frames: [{ at: 1 }],
      })
      expect(JSON.parse(await readFile(join(output, 'final-raw.json'), 'utf8'))).toMatchObject({
        frames: [{ at: 2 }],
      })
      expect(receipts).toEqual([
        {
          status: mode === 'fallback' ? 'fallback-written' : 'unavailable',
          codes:
            mode === 'fallback'
              ? ['EISDIR']
              : mode === 'unavailable'
                ? ['EISDIR', 'EISDIR']
                : ['ENOENT', 'ENOENT'],
        },
      ])
      if (mode !== 'fallback') return
      const fallback = await readFile(join(output, 'entry-transport.json.fallback.txt'), 'utf8')
      expect(fallback).not.toContain(output)
      expect(JSON.parse(fallback)).toMatchObject({
        persistence: { status: 'fallback-written', codes: ['EISDIR'] },
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('entry callbacks preserve handled and unhandled public error identity when observation throws', () => {
  const original = (() => {
    try {
      JSON.parse('external event error')
    } catch (error) {
      return error
    }
  })()
  const emitter = new EventEmitter()
  observeRetentionEntryEvents(emitter, () => {
    throw original
  })
  let unhandled: unknown
  try {
    emitter.emit('error', original)
  } catch (error) {
    unhandled = error
  }
  expect(unhandled).toBe(original)
  const received: unknown[] = []
  emitter.on('error', (value) => received.push(value))
  expect(emitter.emit('error', original)).toBe(true)
  expect(received).toEqual([original])
  expect(emitter.listenerCount('error')).toBe(1)
  expect(
    retentionEntryErrorCode({
      get code() {
        throw original
      },
    }),
  ).toBeNull()
  expect(retentionEntryErrorCode({ code: 'ECONNRESET', message: 'private-sentinel' })).toBe(
    'ECONNRESET',
  )
})

test.for(
  ['node', 'bun'].flatMap((runtime) =>
    ['closed', 'stalled', 'reporting'].map((mode) => ({ runtime, mode })),
  ),
)(
  'review F1 $runtime diagnostic writer $mode preserves primary and bounds queued metadata',
  async ({ runtime, mode }, { skip }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt} from ${JSON.stringify(source)};let writer;for(let n=0;n<${mode === 'closed' ? 1 : 10000};n++)writer=writeRetentionEntryReceipt({at:1,pid:process.pid,tick:'1',kind:'request',requestId:n,socketId:1,path:'/'+ 'x'.repeat(1000),method:'GET'});const peakBytes=process.stdout.writableLength;const peakPending=writer?.inspect?.().pendingBytes??null;setTimeout(()=>{process.stderr.write(JSON.stringify({primary:true,peakBytes,peakPending,stdoutBytes:process.stdout.writableLength,listeners:process.stdout.listenerCount('error'),writer:writer?.inspect?.()??null}));process.exit(0)},30)`
    const args =
      runtime === 'node'
        ? [
            '--experimental-strip-types',
            '--disable-warning=ExperimentalWarning',
            '--input-type=module',
            '--eval',
            script,
          ]
        : ['--eval', script]
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = once(child, 'close')
    const capture = createRetentionEntryCapture()
    if (mode === 'reporting') child.stdout.on('data', (data: Buffer) => capture.read(data))
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    if (mode === 'closed') child.stdout.destroy()
    const [code] = await closed
    child.stdout.destroy()
    expect(code).toBe(0)
    const facts = JSON.parse(stderr)
    expect(facts).toMatchObject({ primary: true, listeners: 0 })
    expect(facts.peakBytes).toBeLessThanOrEqual(retentionEntryReceiptLimits.recordBytes)
    expect(facts.peakPending).toBeLessThanOrEqual(
      retentionEntryReceiptLimits.recordBytes + retentionEntryReceiptPrefix.length + 1,
    )
    expect(facts.stdoutBytes).toBeLessThanOrEqual(retentionEntryReceiptLimits.recordBytes)
    expect(facts.writer.pendingBytes).toBeLessThanOrEqual(
      retentionEntryReceiptLimits.recordBytes + retentionEntryReceiptPrefix.length + 1,
    )
    if (mode === 'stalled' || mode === 'reporting') expect(facts.writer.dropped).toBeGreaterThan(0)
    if (mode === 'closed') expect(facts.writer).toMatchObject({ unavailable: true, code: 'EPIPE' })
    if (mode === 'reporting') expect(capture.inspect().dropped).toBe(facts.writer.dropped)
  },
)

test('review F2 original and decoded traversal cannot lose the FS discriminator', () => {
  const root = join(tmpdir(), 'receipt-root')
  for (const target of [
    '/@fs/../../outside-private.ts',
    '/@fs/%2e%2e/%2e%2e/outside-private.ts',
    '/@fs/..\\outside-private.ts',
    '/@fs/%5coutside-private.ts',
    'http://localhost/@fs/../../outside-private.ts',
    '/src/../outside-private.ts',
  ])
    expect(retentionEntryModulePath(root, target)).toBeNull()
  expect(retentionEntryModulePath(root, '/@fs' + join(root, 'module.ts'))).toBe('/module.ts')
})

test('review F3 known completion survives serial frozen cases and ordinary overflow', async () => {
  const output = await mkdtemp(join(tmpdir(), 'receipt-shared-'))
  const first = join(output, 'first'),
    second = join(output, 'second')
  await mkdir(first)
  await mkdir(second)
  const capture = createRetentionEntryCapture(),
    time = retentionEntryReceiptTime()
  const completion = {
    ...time,
    kind: 'response-finish',
    requestId: 73,
    socketId: 1,
    path: '/module.ts',
    status: 200,
    complete: true,
  }
  try {
    capture.accept(completion)
    for (const path of [first, second]) {
      capture.begin(path)
      capture.accept({ ...time, kind: 'route-failure', transportRequestId: 1, path: '/module.ts' })
      await capture.fail(path, 'reload')
      capture.end(path)
      for (let n = 0; n < retentionEntryReceiptLimits.records; n++)
        capture.accept({ ...time, kind: 'socket-close', socketId: n })
    }
    await capture.persistFailures()
    for (const path of [first, second])
      expect(JSON.parse(await readFile(join(path, 'entry-transport.json'), 'utf8'))).toMatchObject({
        sameModulePredecessors: [completion],
        truncated: true,
      })
    expect(capture.inspect().retainedBytes).toBeLessThanOrEqual(retentionEntryReceiptLimits.bytes)
    expect(capture.inspect().retainedRecords).toBeLessThanOrEqual(
      retentionEntryReceiptLimits.records,
    )
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('review F4 malformed UTF8 is refused while fragmented valid Unicode survives', async () => {
  const output = await mkdtemp(join(tmpdir(), 'receipt-utf8-')),
    capture = createRetentionEntryCapture()
  const packet =
    retentionEntryReceiptPrefix +
    JSON.stringify(
      entryControlFrame({
        ...retentionEntryReceiptTime(),
        kind: 'request',
        requestId: 1,
        socketId: 1,
        path: '/x.ts',
        method: 'GET',
      }),
    ) +
    '\n'
  const invalid = Buffer.from(packet)
  invalid[invalid.indexOf('/x.ts') + 1] = 255
  try {
    capture.begin(output)
    capture.read(invalid)
    const valid = Buffer.from(packet.replace('/x.ts', '/שלום.ts'))
    for (let n = 0; n < valid.length; n++) capture.read(valid.subarray(n, n + 1))
    capture.finishWire()
    await capture.fail(output, 'entry')
    await capture.persistFailures()
    const text = await readFile(join(output, 'entry-transport.json'), 'utf8')
    expect(text).not.toContain('\uFFFD')
    expect(JSON.parse(text)).toMatchObject({
      refused: 1,
      failureWindow: [{ kind: 'request', path: '/שלום.ts' }],
    })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === 'win32')(
  'review F5 actual owned child SIGINT is retained',
  async () => {
    const output = await mkdtemp(join(tmpdir(), 'receipt-signal-')),
      capture = createRetentionEntryCapture()
    const child = spawn(
      'node',
      ['--eval', "process.stdout.write('ready');setInterval(()=>{},1000)"],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const exited = once(child, 'exit')
    try {
      capture.begin(output)
      await once(child.stdout, 'data')
      child.kill('SIGINT')
      const [exitCode, signal] = await exited
      capture.accept({
        ...retentionEntryReceiptTime(),
        kind: 'process-exit',
        childPid: child.pid,
        exitCode,
        signal,
      })
      await capture.fail(output, 'entry')
      await capture.persistFailures()
      expect(
        JSON.parse(await readFile(join(output, 'entry-transport.json'), 'utf8')),
      ).toMatchObject({ refused: 0, failureWindow: [{ kind: 'process-exit', signal: 'SIGINT' }] })
    } finally {
      child.kill('SIGKILL')
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('review F6 frozen receipt persists before later cleanup or teardown', async () => {
  const output = await mkdtemp(join(tmpdir(), 'receipt-immediate-')),
    capture = createRetentionEntryCapture()
  try {
    capture.begin(output)
    capture.accept({ ...retentionEntryReceiptTime(), kind: 'socket-close', socketId: 73 })
    await capture.fail(output, 'reload')
    expect(
      JSON.parse(await readFile(join(output, 'entry-transport.frozen.json'), 'utf8')),
    ).toMatchObject({
      archiveStage: 'failure-frozen',
      endedAt: null,
      postFailureTail: [],
      failureWindow: [{ kind: 'socket-close', socketId: 73 }],
    })
    capture.end(output)
    await capture.persistFailures()
    expect(JSON.parse(await readFile(join(output, 'entry-transport.json'), 'utf8'))).toMatchObject({
      archiveStage: 'entry-teardown',
      endedAt: expect.any(Number),
    })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.for(['missing', 'EISDIR'] as const)(
  'review F6 immediate %s IO stays secondary while every original cleanup runs',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'receipt-frozen-io-'))
    const target = mode === 'missing' ? join(output, 'absent') : output
    const capture = createRetentionEntryCapture()
    const primary = (() => {
      try {
        JSON.parse('external primary')
      } catch (error) {
        return error
      }
    })()
    const attempts: string[] = []
    try {
      if (mode === 'EISDIR') {
        await mkdir(join(target, 'entry-transport.frozen.json'))
        await mkdir(join(target, 'entry-transport.frozen.json.fallback.txt'))
      }
      capture.begin(target)
      capture.accept({ ...retentionEntryReceiptTime(), kind: 'socket-close', socketId: 73 })
      const snapshot = capture.fail(target, 'reload')
      const cleanup = await settleRetentionReloadCleanup([
        {
          stage: 'original-primary',
          run: async () => {
            attempts.push('original-primary')
            throw primary
          },
        },
        {
          stage: 'raw',
          run: async () => {
            attempts.push('raw')
            await archiveRetentionReloadFailure(output, { frames: [{ at: 73 }] })
          },
        },
        {
          stage: 'close',
          run: async () => {
            attempts.push('close')
          },
        },
      ])
      expect(cleanup[0]?.error).toBe(primary)
      expect(cleanup.slice(1).map((item) => item.error)).toEqual([null, null])
      expect(attempts).toEqual(['original-primary', 'raw', 'close'])
      expect(await snapshot).toEqual({
        status: 'unavailable',
        codes: mode === 'missing' ? ['ENOENT', 'ENOENT'] : ['EISDIR', 'EISDIR'],
      })
      expect(JSON.parse(await readFile(join(output, 'failed-raw.json'), 'utf8'))).toEqual({
        frames: [{ at: 73 }],
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('review F5 owned stop intents still refuse SIGINT and private signal strings', () => {
  const capture = createRetentionEntryCapture()
  capture.accept({
    ...retentionEntryReceiptTime(),
    kind: 'process-stop',
    childPid: 73,
    signal: 'SIGINT',
  })
  capture.accept({
    ...retentionEntryReceiptTime(),
    kind: 'process-exit',
    childPid: 73,
    exitCode: null,
    signal: 'private-signal',
  })
  expect(capture.inspect().refused).toBe(2)
})

const wireControlCoverage = {
  countersExact: true,
  observed: 1,
  dropped: 0,
  refused: 0,
  droppedByKind: {},
  refusedByReason: { 'input-schema': 0, 'record-bytes': 0, 'tap-path': 0 },
  queuedRecords: 0,
  queuedBytes: 0,
  inFlightRecords: 1,
  inFlightBytes: 4096,
  unavailable: false,
  code: null,
}

test.for(['partial', 'rejected'])(
  'Bun entry output keeps incomplete %s completion unavailable',
  async (mode, { skip }) => {
    const executable = controlRuntime('bun')
    if (!executable) {
      skip('System Bun is unavailable')
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime} from ${JSON.stringify(source)};
const primary=(()=>{try{JSON.parse('controlled primary')}catch(error){return error}})();Object.assign(primary,{code:'EPIPE'});let calls=0;
Bun.write=(_target,encoded)=>{calls++;return ${mode === 'partial' ? 'Promise.resolve(encoded.byteLength-1)' : 'Promise.reject(primary)'}};
const event={...retentionEntryReceiptTime(),kind:'request',socketId:1,path:'/controlled.ts',method:'GET'};let writer;
for(let requestId=1;requestId<=3;requestId++)writer=writeRetentionEntryReceipt({...event,requestId});await new Promise(setImmediate);writer.write({...event,requestId:4});
let observed;try{throw primary}catch(error){observed=error}process.stderr.write(JSON.stringify({calls,identity:observed===primary,state:writer.inspect()}));`
    const child = spawn(executable, ['--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    const [code, signal] = await closed
    child.stdout.destroy()
    expect(code).toBe(0)
    expect(signal).toBeNull()
    expect(JSON.parse(stderr)).toMatchObject({
      calls: 1,
      identity: true,
      state: {
        unavailable: true,
        code: mode === 'partial' ? 'EIO' : 'EPIPE',
        pendingBytes: 0,
        queuedRecords: 0,
        dropped: 4,
        refused: 0,
        countersExact: true,
      },
    })
  },
)

test.for(['node', 'bun'])(
  'entry output preserves the primary for unsupported regular-file $0 output',
  async (runtime, { skip }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const output = await mkdtemp(join(tmpdir(), 'retention-output-kind-'))
    const path = join(output, 'output')
    const file = await open(path, 'w')
    try {
      const source = pathToFileURL(
        join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
      ).href
      const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime} from ${JSON.stringify(source)};
const primary=(()=>{try{JSON.parse('controlled primary')}catch(error){return error}})();let observed;try{throw primary}catch(error){observed=error}
const writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),kind:'socket-open',socketId:1,port:52865});process.stderr.write(JSON.stringify({unavailable:writer===undefined,identity:observed===primary}));`
      const child = spawn(executable, ['--experimental-strip-types', '--eval', script], {
        stdio: ['ignore', file.fd, 'pipe'],
      })
      const closed = once(child, 'close')
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      const [code, signal] = await closed
      expect(code).toBe(0)
      expect(signal).toBeNull()
      expect(JSON.parse(stderr)).toEqual({ unavailable: true, identity: true })
      expect(await readFile(path, 'utf8')).toBe('')
    } finally {
      await file.close()
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['node', 'bun'])(
  'parent stop terminates the pending $0 entry output',
  async (runtime, { skip, annotate }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime,retentionEntryBudget} from ${JSON.stringify(source)};let writer;
for(let requestId=1;requestId<=80;requestId++)writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),kind:'request',requestId,socketId:1,path:'/'+'"'.repeat(1023),method:'GET'});
for(let turn=0;turn<retentionEntryBudget.producer.factCells;turn++)await new Promise(setImmediate);
process.stderr.write(JSON.stringify({runtime:process.versions.bun?'bun':'node',state:writer.inspect(),listeners:process.stdout.listenerCount('error')})+String.fromCharCode(10));await new Promise(()=>{});`
    const child = spawn(executable, ['--experimental-strip-types', '--eval', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = once(child, 'close')
    let stderr = ''
    let markReady = () => {}
    const ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.includes('\n')) markReady()
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    try {
      await Promise.race([ready, closed])
      const facts = JSON.parse(stderr)
      expect(facts).toMatchObject({
        runtime,
        listeners: 0,
        state: { unavailable: false, dropped: 16, pendingRecords: 1 },
      })
      expect(facts.state.pendingBytes).toBeGreaterThan(0)
      expect(facts.state.retainedBytes).toBeLessThanOrEqual(retentionEntryBudget.producer.bytes)
      expect(facts.state.retainedRecords).toBeLessThanOrEqual(retentionEntryBudget.producer.records)
      expect(child.kill('SIGTERM')).toBe(true)
      const [code, signal] = await closed
      expect(code).toBeNull()
      expect(signal).toBe('SIGTERM')
      expect(child.exitCode).toBeNull()
      expect(child.signalCode).toBe('SIGTERM')
      await annotate(JSON.stringify({ executable, facts, code, signal }), 'writer-owned-stop')
    } finally {
      clearTimeout(timer)
      child.stdout.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  },
)

function entryControlFrame(event: unknown, sequence = 1) {
  return {
    version: 2,
    kind: 'facts',
    pid: process.pid,
    emittedAt: Date.now(),
    emittedTick: '1',
    facts: [{ observationSequence: sequence, event }],
    coverage: { ...wireControlCoverage, observed: sequence },
  }
}

// The child drives the actual writer over an owned OS pipe; it serves no application.
test.for(
  ['node', 'bun'].flatMap((runtime) =>
    ['paced', 'burst', 'summary', 'overflow', 'closed', 'stalled'].map((mode) => ({
      runtime,
      mode,
    })),
  ),
)(
  'writer v2 $runtime $mode retains FIFO facts and explicit bounded loss',
  async ({ runtime, mode }, { annotate, skip }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime} from ${JSON.stringify(source)};
const mode=${JSON.stringify(mode)};let writer;let peakRecords=0,peakBytes=0;const until=Date.now()+15000;
const primary=(()=>{try{JSON.parse('controlled primary')}catch(error){return error}})();let observedPrimary;try{throw primary}catch(error){observedPrimary=error}
async function idle(){while(writer?.inspect().pendingBytes){if(Date.now()>until)throw {code:'CONTROL_TIMEOUT'};await new Promise(setImmediate)}}
function offer(event){writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),...event});const view=writer.inspect();peakRecords=Math.max(peakRecords,view.retainedRecords);peakBytes=Math.max(peakBytes,view.retainedBytes)}
if(mode==='summary')offer({kind:'unknown',body:'private-sentinel'});
if(mode==='closed')offer({kind:'socket-open',socketId:1,port:52865});
if(['paced','burst','summary'].includes(mode))for(let id=1;id<=16;id++){const path='/controlled/module-'+id+'.ts';for(const event of [{kind:'socket-open',socketId:id,port:52865},{kind:'request',requestId:id,socketId:id,path,method:'GET'},{kind:'response-finish',requestId:id,socketId:id,path,status:200,complete:true},{kind:'socket-close',socketId:id}]){if(mode==='paced')await idle();offer(event)}}
if(mode==='overflow'||mode==='stalled')for(let id=1;id<=80;id++)offer({kind:'request',requestId:id,socketId:1,path:mode==='stalled'?'/'+ '"'.repeat(1023):'/controlled/'+id+'.ts',method:'GET'});
if(mode==='overflow'){await idle();offer({kind:'request',requestId:81,socketId:1,path:'/controlled/81.ts',method:'GET'})}
if(mode!=='closed'&&mode!=='stalled')await idle();
setTimeout(()=>{process.stderr.write(JSON.stringify({state:writer.inspect(),peakRecords,peakBytes,primaryIdentity:primary===observedPrimary,publicStdoutErrors:process.stdout.listenerCount('error')}));process.exit(0)},30);
`
    const args =
      runtime === 'node'
        ? [
            '--experimental-strip-types',
            '--disable-warning=ExperimentalWarning',
            '--input-type=module',
            '--eval',
            script,
          ]
        : ['--eval', script]
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    const capture = createRetentionEntryCapture()
    const chunks: Buffer[] = []
    let stderr = ''
    if (mode !== 'closed' && mode !== 'stalled')
      child.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        capture.read(chunk)
      })
    child.stdout.once('end', () => capture.finishWire())
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    if (mode === 'closed') child.stdout.destroy()
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    const [code, signal] = await closed
    clearTimeout(timer)
    child.stdout.destroy()
    expect(code).toBe(0)
    expect(signal).toBeNull()
    const facts = JSON.parse(stderr)
    expect(facts).toMatchObject({ primaryIdentity: true, publicStdoutErrors: 0 })
    expect(facts.peakRecords).toBeLessThanOrEqual(retentionEntryBudget.producer.records)
    expect(facts.peakBytes).toBeLessThanOrEqual(retentionEntryBudget.producer.bytes)
    expect(facts.state.pendingBytes).toBeLessThanOrEqual(
      retentionEntryReceiptLimits.recordBytes + retentionEntryReceiptPrefix.length + 1,
    )
    const frames = Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .filter((line) => line.startsWith(retentionEntryReceiptPrefix))
      .map((line) => JSON.parse(line.slice(retentionEntryReceiptPrefix.length)))
    for (const frame of frames)
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(
        retentionEntryReceiptLimits.recordBytes,
      )
    const delivered = frames.flatMap((frame) => (frame.kind === 'facts' ? frame.facts : []))
    if (['paced', 'burst', 'summary'].includes(mode)) {
      expect(facts.state.dropped).toBe(0)
      expect(delivered).toHaveLength(64)
      for (let id = 1; id <= 16; id++)
        expect(
          delivered.filter((item) => item.event.socketId === id).map((item) => item.event.kind),
        ).toEqual(['socket-open', 'request', 'response-finish', 'socket-close'])
      expect(capture.inspect().relayRefused).toBe(0)
    }
    if (mode === 'summary') {
      expect(frames[0]?.kind).toBe('summary')
      const middle = frames.slice(1, -1)
      expect(middle.every((frame) => frame.kind === 'facts')).toBe(true)
      expect(capture.inspect().refused).toBe(1)
    }
    if (mode === 'overflow') {
      expect(facts.state.dropped).toBe(16)
      expect(facts.state.droppedByKind.request).toBe(16)
      expect(delivered.map((item) => item.event.requestId)).toEqual([
        ...Array.from({ length: 64 }, (_, index) => index + 1),
        81,
      ])
      expect(capture.inspect().observations).toMatchObject({
        lastReceived: 81,
        gaps: 16,
        firstGap: { from: 65, to: 80 },
      })
      expect(capture.inspect().dropped).toBe(16)
    }
    if (mode === 'closed')
      expect(facts.state).toMatchObject({
        unavailable: true,
        code: 'EPIPE',
        dropped: 1,
        queuedRecords: 0,
      })
    if (mode === 'stalled') expect(facts.state.dropped).toBe(16)
    await annotate(
      JSON.stringify({
        runtime,
        executable,
        mode,
        facts,
        delivered: delivered.length,
        relay: capture.inspect(),
        frameKinds: frames.map((frame) => frame.kind),
      }),
      'writer-v2-pipe-control',
    )
  },
)

test('writer v2 strict envelopes retain fragmented UTF8 and reject private/schema/sequence data', async () => {
  const output = await mkdtemp(join(tmpdir(), 'writer-v2-parser-'))
  const capture = createRetentionEntryCapture()
  const time = retentionEntryReceiptTime()
  try {
    capture.begin(output)
    const good = entryControlFrame({
      ...time,
      kind: 'request',
      requestId: 1,
      socketId: 1,
      path: '/שלום.ts',
      method: 'GET',
    })
    const bytes = Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(good) + '\n')
    for (let index = 0; index < bytes.length; index++)
      capture.read(bytes.subarray(index, index + 1))
    const invalid = Buffer.from(
      retentionEntryReceiptPrefix +
        JSON.stringify(
          entryControlFrame(
            { ...time, kind: 'request', requestId: 2, socketId: 1, path: '/x.ts', method: 'GET' },
            2,
          ),
        ) +
        '\n',
    )
    invalid[invalid.indexOf('/x.ts') + 1] = 255
    capture.read(invalid)
    for (const input of [
      { ...good, version: 1 },
      { ...good, authorization: 'private-sentinel' },
      {
        ...good,
        facts: [
          {
            observationSequence: 2,
            event: {
              ...time,
              kind: 'request',
              requestId: 2,
              socketId: 1,
              path: '/source.ts?private-sentinel',
              method: 'GET',
            },
          },
        ],
      },
      good,
      { ...good, pid: 0 },
      { ...good, coverage: { ...wireControlCoverage, queuedRecords: 65 } },
      { ...good, coverage: { ...wireControlCoverage, dropped: 1 } },
    ])
      capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(input) + '\n'))
    expect(capture.inspect().relayRefused).toBe(8)
    await capture.fail(output, 'reload')
    capture.end(output)
    capture.finishWire()
    await capture.persistFailures()
    const text = await readFile(join(output, 'entry-transport.json'), 'utf8')
    expect(text).not.toContain('private-sentinel')
    expect(text).not.toContain('\uFFFD')
    expect(JSON.parse(text)).toMatchObject({
      version: 2,
      failureWindow: [{ kind: 'request', path: '/שלום.ts' }],
      producerAtFailure: { coverage: { observed: 1 } },
      observationsAtFailure: { lastReceived: 1, gaps: 0 },
    })
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.for(['records', 'bytes'] as const)(
  'writer v2 combined %s limit and serial latest completions retain truthful freeze',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'writer-v2-owner-'))
    const first = join(output, 'first'),
      second = join(output, 'second')
    await mkdir(first)
    await mkdir(second)
    const capture = createRetentionEntryCapture(),
      time = retentionEntryReceiptTime()
    try {
      expect(
        retentionEntryBudget.producer.records +
          retentionEntryBudget.clientJournal.records +
          retentionEntryBudget.servingJournal.records +
          retentionEntryBudget.relay.records,
      ).toBe(retentionEntryReceiptLimits.records)
      expect(
        retentionEntryBudget.producer.bytes +
          retentionEntryBudget.clientJournal.bytes +
          retentionEntryBudget.servingJournal.bytes +
          retentionEntryBudget.relay.bytes,
      ).toBe(retentionEntryReceiptLimits.bytes)
      const completion = {
        ...time,
        kind: 'response-finish',
        requestId: 73,
        socketId: 1,
        path: '/module.ts',
        status: 200,
        complete: true,
      }
      capture.accept(completion)
      for (const folder of [first, second]) {
        capture.begin(folder)
        capture.accept({
          ...time,
          kind: 'route-failure',
          transportRequestId: 73,
          path: '/module.ts',
        })
        await capture.fail(folder, 'reload')
        capture.end(folder)
        for (let id = 0; id <= retentionEntryBudget.relay.records; id++)
          capture.accept({
            ...time,
            kind: 'request',
            requestId: id,
            socketId: 1,
            path: mode === 'bytes' ? '/' + 'x'.repeat(1000) : '/overflow.ts',
            method: 'GET',
          })
        expect(capture.inspect().retainedRecords).toBeLessThanOrEqual(
          retentionEntryReceiptLimits.records,
        )
        expect(capture.inspect().retainedBytes).toBeLessThanOrEqual(
          retentionEntryReceiptLimits.bytes,
        )
      }
      expect(capture.inspect().relayDropped).toBeGreaterThan(0)
      await capture.persistFailures()
      for (const folder of [first, second])
        expect(
          JSON.parse(await readFile(join(folder, 'entry-transport.json'), 'utf8')),
        ).toMatchObject({
          sameModulePredecessors: [completion],
          truncated: true,
          budget: retentionEntryBudget,
        })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['missing', 'EISDIR'] as const)(
  'writer v2 immediate %s fault preserves the primary and all cleanup',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'writer-v2-io-'))
    const target = mode === 'missing' ? join(output, 'absent') : output
    const capture = createRetentionEntryCapture()
    const primary = (() => {
      try {
        JSON.parse('controlled primary')
      } catch (error) {
        return error
      }
    })()
    const attempts: string[] = []
    try {
      if (mode === 'EISDIR') {
        await mkdir(join(target, 'entry-transport.frozen.json'))
        await mkdir(join(target, 'entry-transport.frozen.json.fallback.txt'))
      }
      capture.begin(target)
      capture.accept({
        ...retentionEntryReceiptTime(),
        kind: 'process-exit',
        childPid: 73,
        exitCode: null,
        signal: 'SIGINT',
      })
      const immediate = capture.fail(target, 'reload')
      const cleanup = await settleRetentionReloadCleanup([
        {
          stage: 'primary',
          run: async () => {
            attempts.push('primary')
            throw primary
          },
        },
        {
          stage: 'raw',
          run: async () => {
            attempts.push('raw')
            await archiveRetentionReloadFailure(output, { frames: [{ at: 73 }] })
          },
        },
        {
          stage: 'close',
          run: async () => {
            attempts.push('close')
          },
        },
      ])
      expect(cleanup[0]?.error).toBe(primary)
      expect(attempts).toEqual(['primary', 'raw', 'close'])
      expect(cleanup.slice(1).map((item) => item.error)).toEqual([null, null])
      expect(await immediate).toEqual({
        status: 'unavailable',
        codes: mode === 'missing' ? ['ENOENT', 'ENOENT'] : ['EISDIR', 'EISDIR'],
      })
      expect(JSON.parse(await readFile(join(output, 'failed-raw.json'), 'utf8'))).toEqual({
        frames: [{ at: 73 }],
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['claimed-loss', 'observed-regression'] as const)(
  'writer boundary R1 %s retains the prior valid producer digest',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'writer-boundary-coverage-')),
      capture = createRetentionEntryCapture(),
      time = retentionEntryReceiptTime()
    try {
      capture.begin(output)
      const good = entryControlFrame({ ...time, kind: 'socket-open', socketId: 1, port: 52865 })
      capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(good) + '\n'))
      const before = capture.inspect().producer
      const summary = {
        version: 2,
        kind: 'summary',
        pid: process.pid,
        emittedAt: Date.now(),
        emittedTick: '2',
        coverage: {
          ...wireControlCoverage,
          inFlightRecords: 0,
          inFlightBytes: 0,
          observed: mode === 'observed-regression' ? 0 : 1,
          dropped: mode === 'claimed-loss' ? 1 : 0,
          droppedByKind: mode === 'claimed-loss' ? { 'socket-open': 1 } : {},
        },
      }
      capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(summary) + '\n'))
      expect(capture.inspect().relayRefused).toBe(1)
      expect(capture.inspect().producer).toEqual(before)
      expect(capture.inspect().dropped).toBe(0)
      expect(capture.inspect().observations.lastReceived).toBe(1)
      await capture.fail(output, 'reload')
      const packet = JSON.parse(await readFile(join(output, 'entry-transport.frozen.json'), 'utf8'))
      expect(packet).toMatchObject({
        dropped: 0,
        failureWindow: [{ kind: 'socket-open', socketId: 1 }],
        producerAtFailure: before,
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.for(['node', 'bun'] as const)(
  'writer boundary R2 %s refusal arithmetic leaves later facts encodable',
  async (runtime, { skip }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime} from ${JSON.stringify(source)};let writer;const until=Date.now()+15000;async function idle(){while(writer?.inspect().pendingBytes){if(Date.now()>until)throw {code:'CONTROL_TIMEOUT'};await new Promise(setImmediate)}}
const primary=(()=>{try{JSON.parse('controlled primary')}catch(error){return error}})();let seen;try{throw primary}catch(error){seen=error}
for(const count of [Number.MAX_SAFE_INTEGER,1]){writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),kind:'refused',count});await idle()}
for(const kind of ['socket-open','socket-close']){writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),kind,socketId:73,...(kind==='socket-open'?{port:52865}:{})});await idle()}
process.stderr.write(JSON.stringify({state:writer.inspect(),primaryIdentity:seen===primary,publicStdoutErrors:process.stdout.listenerCount('error')}));`
    const args =
      runtime === 'node'
        ? [
            '--experimental-strip-types',
            '--disable-warning=ExperimentalWarning',
            '--input-type=module',
            '--eval',
            script,
          ]
        : ['--eval', script]
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
      closed = once(child, 'close'),
      capture = createRetentionEntryCapture()
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      capture.read(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdout.once('end', () => capture.finishWire())
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    const [code, signal] = await closed
    clearTimeout(timer)
    expect(code).toBe(0)
    expect(signal).toBeNull()
    const facts = JSON.parse(stderr),
      frames = Buffer.concat(chunks)
        .toString('utf8')
        .split('\n')
        .filter((line) => line.startsWith(retentionEntryReceiptPrefix))
        .map((line) => JSON.parse(line.slice(retentionEntryReceiptPrefix.length))),
      delivered = frames.flatMap((frame) => (frame.kind === 'facts' ? frame.facts : []))
    expect(facts).toMatchObject({
      primaryIdentity: true,
      publicStdoutErrors: 0,
      state: {
        refused: Number.MAX_SAFE_INTEGER,
        dropped: 0,
        unavailable: false,
        code: null,
        countersExact: false,
      },
    })
    expect(facts.state.refusedByReason['record-bytes']).toBe(0)
    expect(delivered.map((item) => item.event.kind)).toEqual(['socket-open', 'socket-close'])
    expect(capture.inspect().relayRefused).toBe(0)
    expect(capture.inspect().producer?.coverage).toMatchObject({
      refused: Number.MAX_SAFE_INTEGER,
      countersExact: false,
      observed: 2,
      dropped: 0,
    })
  },
)

test.for([
  'observed',
  'dropped',
  'dropped-kind',
  'removed-kind',
  'refused',
  'refused-reason',
  'exactness',
] as const)('writer boundary R1 %s cumulative regression preserves the last sample', (mode) => {
  const capture = createRetentionEntryCapture()
  const previous = {
    ...wireControlCoverage,
    countersExact: mode !== 'exactness',
    observed: 6,
    dropped: 2,
    droppedByKind: { 'socket-open': 2 },
    refused: 3,
    refusedByReason: { 'input-schema': 0, 'record-bytes': 0, 'tap-path': 3 },
    inFlightRecords: 0,
    inFlightBytes: 0,
  }
  const summary = {
    version: 2,
    kind: 'summary',
    pid: process.pid,
    emittedAt: Date.now(),
    emittedTick: '1',
    coverage: previous,
  }
  capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(summary) + '\n'))
  const before = capture.inspect().producer
  expect(before?.coverage).toEqual(previous)
  const changes = {
    observed: { observed: 5 },
    dropped: { dropped: 1, droppedByKind: { 'socket-open': 1 } },
    'dropped-kind': { droppedByKind: { 'socket-open': 1, 'socket-close': 1 } },
    'removed-kind': { droppedByKind: { 'socket-close': 2 } },
    refused: {
      refused: 2,
      refusedByReason: { 'input-schema': 0, 'record-bytes': 0, 'tap-path': 2 },
    },
    'refused-reason': { refusedByReason: { 'input-schema': 1, 'record-bytes': 0, 'tap-path': 2 } },
    exactness: { countersExact: true },
  }
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix +
        JSON.stringify({
          ...summary,
          coverage: { ...previous, ...changes[mode] },
        }) +
        '\n',
    ),
  )
  expect(capture.inspect()).toMatchObject({ relayRefused: 1, dropped: 2, producer: before })
})

test('writer boundary R1 honest gaps and pending coverage survive without counting delivered facts twice', () => {
  const capture = createRetentionEntryCapture(),
    time = retentionEntryReceiptTime()
  const event = { ...time, kind: 'socket-open', socketId: 1, port: 52865 }
  capture.read(
    Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(entryControlFrame(event)) + '\n'),
  )
  const droppedCoverage = { dropped: 1, droppedByKind: { 'socket-close': 1 } }
  const pending = {
    ...entryControlFrame({ ...event, socketId: 3 }, 3),
    coverage: {
      ...wireControlCoverage,
      ...droppedCoverage,
      observed: 4,
      queuedRecords: 1,
      queuedBytes: 4096,
    },
  }
  capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(pending) + '\n'))
  const last = {
    ...entryControlFrame({ ...event, socketId: 4 }, 4),
    coverage: { ...wireControlCoverage, ...droppedCoverage, observed: 4 },
  }
  capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(last) + '\n'))
  const summary = {
    version: 2,
    kind: 'summary',
    pid: process.pid,
    emittedAt: Date.now(),
    emittedTick: '4',
    coverage: { ...last.coverage, inFlightRecords: 0, inFlightBytes: 0 },
  }
  capture.read(Buffer.from(retentionEntryReceiptPrefix + JSON.stringify(summary) + '\n'))
  expect(capture.inspect()).toMatchObject({
    relayRefused: 0,
    dropped: 1,
    producer: { coverage: summary.coverage },
    observations: { lastReceived: 4, gaps: 1, firstGap: { from: 2, to: 2 } },
  })
})

test.for(['local', 'aggregate'] as const)(
  'writer boundary R2 %s refusal totals remain bounded in the frozen packet',
  async (mode) => {
    const output = await mkdtemp(join(tmpdir(), 'writer-boundary-total-'))
    const capture = createRetentionEntryCapture(),
      time = retentionEntryReceiptTime()
    try {
      capture.begin(output)
      capture.accept({
        ...time,
        kind: 'refused',
        count: mode === 'local' ? Number.MAX_SAFE_INTEGER : 1,
      })
      if (mode === 'local') capture.accept({ ...time, kind: 'refused', count: 1 })
      if (mode === 'aggregate')
        capture.read(
          Buffer.from(
            retentionEntryReceiptPrefix +
              JSON.stringify({
                version: 2,
                kind: 'summary',
                pid: process.pid,
                emittedAt: time.at,
                emittedTick: time.tick,
                coverage: {
                  ...wireControlCoverage,
                  observed: 0,
                  inFlightRecords: 0,
                  inFlightBytes: 0,
                  refused: Number.MAX_SAFE_INTEGER,
                  countersExact: false,
                  refusedByReason: {
                    'tap-path': Number.MAX_SAFE_INTEGER,
                    'input-schema': 1,
                    'record-bytes': 0,
                  },
                },
              }) +
              '\n',
          ),
        )
      capture.accept({ ...time, kind: 'socket-close', socketId: 73 })
      expect(capture.inspect()).toMatchObject({
        refused: Number.MAX_SAFE_INTEGER,
        countersExact: false,
        dropped: 0,
      })
      await capture.fail(output, 'reload')
      expect(
        JSON.parse(await readFile(join(output, 'entry-transport.frozen.json'), 'utf8')),
      ).toMatchObject({
        refused: Number.MAX_SAFE_INTEGER,
        countersExact: false,
        dropped: 0,
        failureWindow: [{ kind: 'socket-close', socketId: 73 }],
      })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('writer boundary R2 exact category totals refuse arithmetic overflow', () => {
  const capture = createRetentionEntryCapture(),
    time = retentionEntryReceiptTime()
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix +
        JSON.stringify({
          version: 2,
          kind: 'summary',
          pid: process.pid,
          emittedAt: time.at,
          emittedTick: time.tick,
          coverage: {
            ...wireControlCoverage,
            observed: 0,
            inFlightRecords: 0,
            inFlightBytes: 0,
            refused: Number.MAX_SAFE_INTEGER,
            refusedByReason: {
              'tap-path': Number.MAX_SAFE_INTEGER,
              'input-schema': 1,
              'record-bytes': 0,
            },
          },
        }) +
        '\n',
    ),
  )
  expect(capture.inspect()).toMatchObject({ relayRefused: 1, producer: null, dropped: 0 })
})

test.for(['node', 'bun'] as const)(
  'writer boundary R2 %s schema faults report explicit unavailability',
  async (runtime, { skip }) => {
    const executable = controlRuntime(runtime)
    if (!executable) {
      skip(`System ${runtime} is unavailable`)
      return
    }
    const source = pathToFileURL(
      join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
    ).href
    const script = `import {writeRetentionEntryReceipt,retentionEntryReceiptTime} from ${JSON.stringify(source)};
const writer=writeRetentionEntryReceipt({...retentionEntryReceiptTime(),pid:process.pid+1,kind:'socket-open',socketId:73,port:52865});
writeRetentionEntryReceipt({...retentionEntryReceiptTime(),kind:'socket-close',socketId:73});
process.stderr.write(JSON.stringify(writer.inspect()));`
    const args =
      runtime === 'node'
        ? [
            '--experimental-strip-types',
            '--disable-warning=ExperimentalWarning',
            '--input-type=module',
            '--eval',
            script,
          ]
        : ['--eval', script]
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
      closed = once(child, 'close')
    let stderr = '',
      stdout = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    const [code, signal] = await closed
    clearTimeout(timer)
    expect(code).toBe(0)
    expect(signal).toBeNull()
    expect(stdout).toBe('')
    expect(JSON.parse(stderr)).toMatchObject({
      unavailable: true,
      code: 'WIRE_SCHEMA',
      refused: 0,
      dropped: 2,
      countersExact: true,
      queuedRecords: 0,
      pendingBytes: 0,
      refusedByReason: { 'record-bytes': 0 },
    })
  },
)
