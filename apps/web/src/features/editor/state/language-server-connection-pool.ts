import { errorMessage } from '@workspace/contracts'
import { LspTransportClosedError } from '@singapore-editor/lsp'
import { LspConnectionPool, type LspConnectionPoolEvent } from '@singapore-editor/lsp-plugin'

import { isAbortError } from '@/lib/abort-error'
import { log } from '@/lib/client-logging'

/** Separates the two halves of a pool key without colliding with either. */
const KEY_SEPARATOR = '\u0000'

/** The editor owns the pooling; this owns the two things it cannot know — the key and the log shape. */
const pool = new LspConnectionPool({ onEvent: report })

export type LanguageServerConnectionKey = {
  readonly origin: string
  readonly rootPath: string
  readonly serverId: string
}

export type DiffLanguageServerConnectionKey = LanguageServerConnectionKey & {
  readonly sessionId: string
}

/** The same pair the server's own session pool keys its child processes on. */
export function languageServerConnectionProvider({
  origin,
  rootPath,
  serverId,
}: LanguageServerConnectionKey) {
  return pool.provider(`${origin}${KEY_SEPARATOR}${rootPath}${KEY_SEPARATOR}${serverId}`)
}

export function diffLanguageServerConnectionProvider({
  origin,
  rootPath,
  serverId,
  sessionId,
}: DiffLanguageServerConnectionKey) {
  return pool.provider(
    `${origin}${KEY_SEPARATOR}${rootPath}${KEY_SEPARATOR}${serverId}${KEY_SEPARATOR}diff:${sessionId}`,
  )
}

/** Closes every pooled connection. For teardown and for tests. */
export function resetLanguageServerConnectionPool(): void {
  pool.dispose()
}

function report(event: LspConnectionPoolEvent): void {
  const [origin = '', rootPath = '', serverId = '', owner = 'editor'] =
    event.key.split(KEY_SEPARATOR)
  const fields = {
    action: `lsp.connection.${actionSuffix(event.kind)}`,
    area: 'lsp',
    origin,
    leaseCount: event.leaseCount,
    outcome: event.kind,
    rootPath,
    serverId,
    ownerKind: owner.split(':')[0] ?? 'editor',
    status: event.status,
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.reachedReady === undefined ? {} : { reachedReady: event.reachedReady }),
    ...(event.methods === undefined ? {} : { methods: event.methods }),
    ...(event.error === undefined ? {} : { error: errorMessage(event.error) }),
    ...closeFields(event.error),
  }

  log[eventLevel(event)](fields)
}

function eventLevel(event: LspConnectionPoolEvent): 'debug' | 'info' | 'warn' {
  if (event.kind === 'handler_ignored') return 'warn'
  // `error` means reconnecting gave up, whatever the close code: the server's bare close() is 1000.
  // An AbortError is this side's suspended environment refusing the socket.
  if (event.kind === 'error') return isAbortError(event.error) ? 'info' : 'warn'
  if (event.kind === 'ready' || event.kind === 'closed') return 'info'

  return 'debug'
}

/** The same fields the server's `lsp.socket.close` records, from this end of the socket. */
function closeFields(error: unknown) {
  if (!(error instanceof LspTransportClosedError)) return {}

  return {
    code: error.code,
    reason: error.reason || null,
    receivedCount: error.receivedCount,
    sentCount: error.sentCount,
    wasClean: error.wasClean,
  }
}

/** One question — did this switch cost a handshake — so they share an action and differ by outcome. */
function actionSuffix(kind: LspConnectionPoolEvent['kind']): string {
  if (kind === 'created' || kind === 'reused') return 'acquired'

  return kind
}
