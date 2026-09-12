import { LspConnectionPool, type LspConnectionPoolEvent } from '@singapor/lsp-plugin'

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
  }

  if (event.kind === 'error' || event.kind === 'handler_ignored') {
    log.warn(fields)
    return
  }
  if (event.kind === 'ready' || event.kind === 'closed') {
    log.info(fields)
    return
  }

  log.debug(fields)
}

/** One question — did this switch cost a handshake — so they share an action and differ by outcome. */
function actionSuffix(kind: LspConnectionPoolEvent['kind']): string {
  if (kind === 'created' || kind === 'reused') return 'acquired'

  return kind
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  return String(error)
}
