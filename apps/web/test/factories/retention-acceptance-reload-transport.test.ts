import { http, passthrough } from 'msw'
import { server as requestInterceptor } from '../msw/server'
import { request as playwrightRequest } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures'
import {
  createRetentionReloadTransport,
  archiveRetentionReloadFailure,
  archiveRetentionReloadArtifact,
  settleRetentionReloadCleanup,
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
    const command = owner.race(new Promise<never>(() => {})).catch((error: unknown) => error)
    try {
      await requestArrived
      const cleanup = await settleRetentionReloadCleanup([
        {
          stage: 'cancel-forwarding',
          run: async () => {
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
      expect(await command).toBe(owner.firstError)
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
