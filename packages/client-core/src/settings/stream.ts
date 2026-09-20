import { elapsedMs, nowMs } from '@workspace/utils/timing'
import { errorNumberField, errorStringField, settingsEventSchema } from '@workspace/contracts'
import { type QueryClient } from '@tanstack/query-core'

import * as v from 'valibot'

import type { Client } from '../transport/client'

import { parseSettingsStream } from './write'
import type { createSettingsSnapshotAdmission } from './snapshot-admission'

export type SettingsStreamDependencies = {
  readonly connect: (signal: AbortSignal) => Promise<unknown>
  readonly wait: (delayMs: number, signal: AbortSignal) => Promise<boolean>
}

export type SettingsStreamHost = {
  readonly client: Client
  readonly admission: ReturnType<typeof createSettingsSnapshotAdmission>
  readonly record: (event: Readonly<Record<string, unknown>>) => void
}

export async function superviseSettingsStream(
  queryClient: QueryClient,
  signal: AbortSignal,
  host: SettingsStreamHost,
  overrides: Partial<SettingsStreamDependencies> = {},
) {
  const client = host.client
  const dependencies: SettingsStreamDependencies = {
    connect: (signal) => connectSettingsStream(signal, client),
    wait: waitForReconnect,
    ...overrides,
  }
  let attempt = 0
  let consecutiveFailures = 0
  while (!signal.aborted) {
    attempt += 1
    const result = await runStreamAttempt(queryClient, signal, dependencies.connect, host)
    if (result.outcome === 'aborted') {
      host.record({
        action: 'settings.stream',
        admittedEventCount: result.admittedEventCount,
        area: 'settings',
        attempt,
        durationMs: result.durationMs,
        invalidEventCount: result.invalidEventCount,
        outcome: result.outcome,
        receivedEventCount: result.receivedEventCount,
        refetchOutcome: result.refetchOutcome,
      })
      return
    }

    consecutiveFailures = result.receivedEventCount > 0 ? 0 : consecutiveFailures + 1
    const backoffMs = reconnectDelay(consecutiveFailures)
    host.record({
      action: 'settings.stream',
      admittedEventCount: result.admittedEventCount,
      area: 'settings',
      attempt,
      backoffMs,
      durationMs: result.durationMs,
      errorCode: result.errorCode,
      errorStatus: result.errorStatus,
      invalidEventCount: result.invalidEventCount,
      outcome: result.outcome,
      receivedEventCount: result.receivedEventCount,
      refetchOutcome: result.refetchOutcome,
    })

    if (signal.aborted) return
    if (!(await dependencies.wait(backoffMs, signal))) return
  }
}

async function runStreamAttempt(
  queryClient: QueryClient,
  signal: AbortSignal,
  connect: SettingsStreamDependencies['connect'],
  host: SettingsStreamHost,
) {
  const attemptController = new AbortController()
  const abortAttempt = () => attemptController.abort()
  if (signal.aborted) abortAttempt()
  signal.addEventListener('abort', abortAttempt, { once: true })
  const startedAt = nowMs()
  let admittedEventCount = 0
  let invalidEventCount = 0
  let receivedEventCount = 0
  let refetchOutcome: StreamRefetchOutcome = 'not-needed'

  try {
    const connection = settleConnection(connect(attemptController.signal))
    refetchOutcome = await recoverConfirmedDocument(queryClient, attemptController.signal, host)
    if (refetchOutcome !== 'ok') {
      abortAttempt()
      return streamAttemptResult(
        signal.aborted ? 'aborted' : 'error',
        startedAt,
        admittedEventCount,
        invalidEventCount,
        receivedEventCount,
        refetchOutcome,
      )
    }

    const connected = await connection
    if (connected.kind === 'error') throw connected.error

    const stream = connected.stream
    for await (const event of parseSettingsStream(stream)) {
      receivedEventCount += 1
      const parsed = v.safeParse(settingsEventSchema, event.data)
      if (!parsed.success) {
        invalidEventCount += 1
        continue
      }

      const admission = await host.admission.admitSettingsEvent(queryClient, parsed.output)
      if (admission.admitted) admittedEventCount += 1
    }

    return streamAttemptResult(
      signal.aborted ? 'aborted' : 'disconnected',
      startedAt,
      admittedEventCount,
      invalidEventCount,
      receivedEventCount,
      refetchOutcome,
    )
  } catch (error) {
    return streamAttemptResult(
      signal.aborted ? 'aborted' : 'error',
      startedAt,
      admittedEventCount,
      invalidEventCount,
      receivedEventCount,
      refetchOutcome,
      error,
    )
  } finally {
    signal.removeEventListener('abort', abortAttempt)
  }
}

function streamAttemptResult(
  outcome: 'aborted' | 'disconnected' | 'error',
  startedAt: number,
  admittedEventCount: number,
  invalidEventCount: number,
  receivedEventCount: number,
  refetchOutcome: StreamRefetchOutcome,
  error?: unknown,
) {
  return {
    admittedEventCount,
    durationMs: elapsedMs(startedAt),
    errorCode: errorStringField(error, 'code'),
    errorStatus: errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode'),
    invalidEventCount,
    outcome,
    receivedEventCount,
    refetchOutcome,
  } as const
}

type StreamRefetchOutcome = 'aborted' | 'error' | 'not-needed' | 'ok'

function settleConnection(connection: Promise<unknown>) {
  return connection.then(
    (stream) => ({ kind: 'connected' as const, stream }),
    (error: unknown) => ({ error, kind: 'error' as const }),
  )
}

async function recoverConfirmedDocument(
  queryClient: QueryClient,
  signal: AbortSignal,
  host: SettingsStreamHost,
) {
  try {
    await host.admission.refreshConfirmedSettings(queryClient, signal)
    return 'ok' as const
  } catch {
    return signal.aborted ? ('aborted' as const) : ('error' as const)
  }
}

async function connectSettingsStream(signal: AbortSignal, client: Client) {
  const response = await client.settings.events.get({ fetch: { signal } })
  if (response.error) throw response.error
  return response.data
}

function reconnectDelay(failureCount: number) {
  return Math.min(250 * 2 ** Math.max(0, failureCount - 1), 5_000)
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)

  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => settle(true), delayMs)
    const onAbort = () => settle(false)
    const settle = (ready: boolean) => {
      globalThis.clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      resolve(ready)
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
