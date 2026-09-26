import type { ModelSelection, ProviderModel, ProviderSnapshot } from '@workspace/contracts'

import type { ChatSessionListProjection } from '@workspace/client-core/chat/selectors'

// Building an `Intl.DateTimeFormat` costs orders of magnitude more than formatting with
// one, and these run once per row inside virtualized lists. One formatter per option set,
// built once at module load — a single shared formatter would hand every caller whichever
// shape happened to be requested first.
const timeOfDayFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayMonthFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const weekdayTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
const dayMonthYearFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

export function compareChatSidebarSessions(
  left: ChatSessionListProjection,
  right: ChatSessionListProjection,
) {
  return (
    sessionSortTimestamp(right).localeCompare(sessionSortTimestamp(left)) ||
    left.id.localeCompare(right.id)
  )
}

export function chatSessionPreview(session: ChatSessionListProjection) {
  if (session.latestTurn?.state === 'running') return 'Working'
  if (session.runtime?.lastError) return session.runtime.lastError
  if (session.latestUserMessageAt)
    return `Last message ${formatChatTimestamp(session.latestUserMessageAt)}`

  return 'No messages yet'
}

export function providerModelDisplayLabel(
  provider:
    | { readonly models: readonly Pick<ProviderModel, 'slug' | 'name' | 'shortName'>[] }
    | null
    | undefined,
  modelSelection: Pick<ModelSelection, 'model'>,
) {
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection.model)
  // Fall back to the raw slug: a pretty label for a model the provider does not
  // offer is how a broken catalog ends up confidently naming a model we cannot run.
  if (!model) return modelSelection.model

  return model.shortName ?? model.name
}

export function providerStatusLabel(provider: ProviderSnapshot | null | undefined) {
  if (!provider) return 'Provider unavailable'
  if (provider.status === 'ready') return `${provider.displayLabel} ready`
  if (provider.status === 'warning') return provider.message ?? `${provider.displayLabel} warning`
  if (provider.status === 'disabled') return `${provider.displayLabel} disabled`

  return provider.message ?? `${provider.displayLabel} error`
}

export function formatChatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const today = new Date()
  if (sameLocalDate(date, today)) return timeOfDayFormat.format(date)

  return dayMonthFormat.format(date)
}

/**
 * When a schedule wakes a session: the time today, a weekday and time within the week the
 * harness keeps schedules, and "due" once the moment has passed without a fire.
 */
export function formatWakeTime(value: string, nowMs: number) {
  const atMs = Date.parse(value)
  if (Number.isNaN(atMs)) return ''
  if (atMs <= nowMs) return 'due'

  const date = new Date(atMs)
  if (sameLocalDate(date, new Date(nowMs))) return timeOfDayFormat.format(date)
  if (atMs - nowMs < WEEK_MS) return weekdayTimeFormat.format(date)
  return dayMonthFormat.format(date)
}

export function formatChatDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const today = new Date()
  if (sameLocalDate(date, today)) return 'Today'

  return dayMonthFormat.format(date)
}

/**
 * Compact "how long ago" for list rows, where the question is recency, not the moment.
 *
 * A week is the crossover: up to it, elapsed time is the shorter answer and needs no
 * arithmetic — "6d ago" is last week. Past it, "23d ago" is a subtraction the reader has
 * to perform, and people already think about older work by date, so hand them the date.
 *
 * `nowMs` is a parameter rather than a `Date.now()` read so this stays pure — the caller
 * owns how often the label refreshes, and tests need no fake clock.
 */
export function formatChatRelativeTime(value: string, nowMs: number) {
  const atMs = Date.parse(value)
  if (Number.isNaN(atMs)) return ''

  // A stamp ahead of `nowMs` is skew between the server's clock and the browser's, not a
  // countdown, so it collapses into the same "just happened" bucket.
  const elapsedMs = nowMs - atMs
  if (elapsedMs < MINUTE_MS) return 'now'
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}h ago`
  if (elapsedMs < WEEK_MS) return `${Math.floor(elapsedMs / DAY_MS)}d ago`

  return calendarDateLabel(new Date(atMs), new Date(nowMs))
}

function formatChatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs)) return '0ms'
  if (durationMs < 0) return '0ms'
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`

  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  if (seconds === 0) return `${minutes}m`
  if (seconds === 60) return `${minutes + 1}m`

  return `${minutes}m ${seconds}s`
}

export function formatChatElapsed(startIso: string, endIso: string | undefined | null) {
  if (!endIso) return null

  const startedAtMs = Date.parse(startIso)
  const endedAtMs = Date.parse(endIso)
  if (Number.isNaN(startedAtMs)) return null
  if (Number.isNaN(endedAtMs)) return null
  if (endedAtMs < startedAtMs) return null

  return formatChatDuration(endedAtMs - startedAtMs)
}

export function formatAssistantMessageMeta(createdAt: string, elapsed: string | null) {
  const timestamp = formatChatTimestamp(createdAt)
  if (!elapsed) return timestamp

  return `${timestamp} • ${elapsed}`
}

export function formatWorkingTimer(startIso: string, endIso: string) {
  const startedAtMs = Date.parse(startIso)
  const endedAtMs = Date.parse(endIso)
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return null

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`

  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function sessionSortTimestamp(session: ChatSessionListProjection) {
  return session.activityAt
}

function calendarDateLabel(date: Date, now: Date) {
  // Bare "12 Jun" on something from last year reads as this June.
  if (date.getFullYear() !== now.getFullYear()) return dayMonthYearFormat.format(date)

  return dayMonthFormat.format(date)
}

function sameLocalDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
