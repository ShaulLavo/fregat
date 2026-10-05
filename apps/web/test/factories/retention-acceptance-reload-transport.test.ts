import { http, passthrough } from 'msw'
import { server as requestInterceptor } from '../msw/server'
import { request as playwrightRequest } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures'
import {
  createRetentionReloadTransport,
  archiveRetentionReloadFailure,
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
