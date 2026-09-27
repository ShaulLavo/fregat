import { elapsedMs, nowMs } from '@workspace/utils/timing'
import { errorNumberField, errorStringField, settingsEventSchema } from '@workspace/contracts'
import { type QueryClient } from '@tanstack/query-core'

import * as v from 'valibot'

import type { Client } from '../transport/client'

import { parseSettingsStream } from './write'
import type { createSettingsSnapshotAdmission } from './snapshot-admission'
import { SETTINGS_SNAPSHOT_UNREADABLE, settingsSnapshotUnreadableError } from './structured-errors'

export type SettingsStreamDependencies = {
  readonly connect: (signal: AbortSignal) => Promise<unknown>
  readonly wait: (delayMs: number, signal: AbortSignal) => Promise<boolean>
}

export type SettingsStreamLogLevel = 'debug' | 'info' | 'warn'

/** Why the stream stopped retrying, with the last failure's catalog fields. */
export type SettingsStreamStop = {
  readonly reason: 'unreadable' | 'unreachable'
  readonly failureCount: number
  readonly code?: string
  readonly message?: string
  readonly why?: string
  readonly fix?: string
}

export type SettingsStreamHost = {
  readonly client: Client
  readonly admission: ReturnType<typeof createSettingsSnapshotAdmission>
  readonly record: (
    event: Readonly<Record<string, unknown>> & { readonly level: SettingsStreamLogLevel },
  ) => void
  /** Called once when the stream stops retrying; the page tells the person settings stopped syncing. */
  readonly stopped?: (stop: SettingsStreamStop) => void
}

// About five minutes of failures at the 5 s backoff cap.
export const SETTINGS_STREAM_MAX_FAILURES = 60
const STREAM_OPEN_CONFIRM_MS = 1_000

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
  // Paces reconnects: only a stream that delivered events resets it.
  let quietAttempts = 0
  // The current failure series: attempts that could not refetch or connect.
  let failureCount = 0
  let failingSince = 0
  const connected = () => {
    if (failureCount === 0) return
    host.record({
      action: 'settings.stream',
      area: 'settings',
      attempt,
      failureCount,
      level: 'info',
      outageMs: elapsedMs(failingSince),
      outcome: 'recovered',
    })
    failureCount = 0
  }
  while (!signal.aborted) {
    attempt += 1
    const result = await runStreamAttempt(
      queryClient,
      signal,
      dependencies.connect,
      host,
      connected,
    )
    const event = {
      action: 'settings.stream',
      admittedEventCount: result.admittedEventCount,
      area: 'settings',
      attempt,
      durationMs: result.durationMs,
      invalidEventCount: result.invalidEventCount,
      receivedEventCount: result.receivedEventCount,
      refetchOutcome: result.refetchOutcome,
    }
    if (result.outcome === 'aborted') {
      host.record({ ...event, level: 'debug', outcome: result.outcome })
      return
    }

    quietAttempts = result.receivedEventCount > 0 ? 0 : quietAttempts + 1
    const backoffMs = reconnectDelay(quietAttempts)
    if (result.outcome === 'disconnected') {
      host.record({ ...event, backoffMs, level: 'debug', outcome: result.outcome })
    } else {
      failureCount += 1
      if (failureCount === 1) failingSince = nowMs()
      const stop = stopFor(result.error, failureCount)
      const failure = { ...event, ...errorFields(result.error), failureCount }
      if (stop) {
        host.record({ ...failure, level: 'warn', outcome: 'gave-up', reason: stop.reason })
        host.stopped?.(stop)
        return
      }
      // One warn opens the series; the rest are debug until it recovers or gives up.
      host.record({
        ...failure,
        backoffMs,
        level: failureCount === 1 ? 'warn' : 'debug',
        outcome: result.outcome,
      })
    }

    if (signal.aborted) return
    if (!(await dependencies.wait(backoffMs, signal))) return
  }
}

function stopFor(error: unknown, failureCount: number): SettingsStreamStop | null {
  const reason = stopReason(error, failureCount)
  if (!reason) return null
  return {
    reason,
    failureCount,
    code: errorStringField(error, 'code'),
    message: errorStringField(error, 'message'),
    why: errorStringField(error, 'why'),
    fix: errorStringField(error, 'fix'),
  }
}

// Reading the same document again cannot parse it any better, so an unreadable one stops at once.
function stopReason(error: unknown, failureCount: number): SettingsStreamStop['reason'] | null {
  if (errorStringField(error, 'code') === SETTINGS_SNAPSHOT_UNREADABLE) return 'unreadable'
  if (failureCount >= SETTINGS_STREAM_MAX_FAILURES) return 'unreachable'
  return null
}

function errorFields(error: unknown) {
  return {
    errorCode: errorStringField(error, 'code'),
    errorMessage: errorStringField(error, 'message'),
    errorStatus: errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode'),
  }
}

async function runStreamAttempt(
  queryClient: QueryClient,
  signal: AbortSignal,
  connect: SettingsStreamDependencies['connect'],
  host: SettingsStreamHost,
  connected: () => void,
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
    const refetch = await recoverConfirmedDocument(queryClient, attemptController.signal, host)
    refetchOutcome = refetch.outcome
    if (refetch.outcome !== 'ok') {
      abortAttempt()
      return streamAttemptResult(
        signal.aborted ? 'aborted' : 'error',
        startedAt,
        admittedEventCount,
        invalidEventCount,
        receivedEventCount,
        refetchOutcome,
        refetch.error,
      )
    }

    // An SSE response can stay unresolved until its first event, so a request that has not
    // failed after a moment counts as open.
    const confirm = globalThis.setTimeout(connected, STREAM_OPEN_CONFIRM_MS)
    const opened = await connection.finally(() => globalThis.clearTimeout(confirm))
    if (opened.kind === 'error') throw opened.error
    connected()

    for await (const event of parseSettingsStream(opened.stream)) {
      receivedEventCount += 1
      const parsed = v.safeParse(settingsEventSchema, event.data)
      if (!parsed.success) {
        invalidEventCount += 1
        throw settingsSnapshotUnreadableError(parsed.issues)
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
    error,
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
    // The stream logs the failure series itself, so each read's own failure stays at debug.
    await host.admission.refreshConfirmedSettings(queryClient, signal, { quiet: true })
    return { outcome: 'ok' as const }
  } catch (error) {
    return { error, outcome: signal.aborted ? ('aborted' as const) : ('error' as const) }
  }
}

async function connectSettingsStream(signal: AbortSignal, client: Client) {
  const response = await client.settings.events.get({ fetch: { signal } })
  if (response.error) throw response.error
  return response.data
}

function reconnectDelay(quietAttempts: number) {
  return Math.min(250 * 2 ** Math.max(0, quietAttempts - 1), 5_000)
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
