import { http, passthrough } from 'msw'
import { server as requestInterceptor } from '../msw/server'
import { request as playwrightRequest } from 'playwright'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures'
import {
  createRetentionReloadTransport,
  archiveRetentionReloadFailure,
  archiveRetentionReloadArtifact,
  settleRetentionReloadCleanup,
  createRetentionEntryCapture,
  retentionEntryReceiptLimits,
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
} from './retention-acceptance-reload-transport'

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
      version: 1,
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
    expect(await readdir(output)).toEqual(['entry-transport.json'])
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
    JSON.stringify({
      ...retentionEntryReceiptTime(),
      kind: 'request',
      requestId: 1,
      socketId: 1,
      method: 'GET',
      path: '/apps/web/src/שלום.ts',
    }) +
    '\n'
  const input = Buffer.from('ordinary startup\n' + packet + 'ordinary tail\n')
  for (let index = 0; index < input.length; index++)
    capture.read(input.subarray(index, index + 1), (value) => ordinary.push(value))
  expect(ordinary.join('')).toBe('ordinary startup\nordinary tail\n')
  expect(capture.inspect()).toMatchObject({ refused: 0, retainedRecords: 1 })
  capture.read(Buffer.from(retentionEntryReceiptPrefix + '{broken}\n'))
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix + 'x'.repeat(retentionEntryReceiptLimits.recordBytes + 1) + '\n',
    ),
  )
  capture.read(
    Buffer.from(
      retentionEntryReceiptPrefix +
        JSON.stringify({ ...retentionEntryReceiptTime(), kind: 'socket-close', socketId: 1 }) +
        '\n',
    ),
  )
  expect(capture.inspect()).toMatchObject({ refused: 2, retainedRecords: 2 })
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
