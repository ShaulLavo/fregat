import type { sessionWokeAt } from './unread'

type SnoozeSource = Parameters<typeof sessionWokeAt>[0]
const HOUR = 60 * 60 * 1_000
const DAY = 24 * HOUR

export function effectiveSnoozed(session: SnoozeSource, now: number) {
  const deadline = session.snoozedUntil ? Date.parse(session.snoozedUntil) : NaN
  if (!Number.isFinite(deadline) || deadline <= now) return false
  return !raisedHandWhileSnoozed(session)
}

function raisedHandWhileSnoozed(session: SnoozeSource) {
  if (session.pendingApprovalCount > 0 || session.pendingUserInputCount > 0) return true
  if (
    session.runtime?.status === 'error' &&
    (session.snoozedAt == null ||
      Date.parse(session.runtime.updatedAt) > Date.parse(session.snoozedAt))
  )
    return true
  return (
    session.snoozedAt != null &&
    session.latestTurn?.state === 'completed' &&
    session.latestTurn.completedAt != null &&
    Date.parse(session.latestTurn.completedAt) > Date.parse(session.snoozedAt)
  )
}

export type SnoozePreset = {
  readonly id: string
  readonly label: string
  readonly whenLabel: string
  readonly snoozedUntil: string
}

export function snoozePresets(now: Date): readonly SnoozePreset[] {
  const hour = new Date(now.getTime() + HOUR)
  const threeHours = new Date(now.getTime() + 3 * HOUR)
  const result = [
    preset('hour', 'In 1 hour', hour),
    preset('three-hours', 'In 3 hours', threeHours),
  ]
  const evening = calendarWake(now, 0, 18)
  if (evening.getTime() - now.getTime() > HOUR)
    result.push(preset('evening', 'This evening', evening))
  const tomorrow = calendarWake(now, 1, 9)
  result.push(preset('tomorrow', 'Tomorrow', tomorrow))
  const nextWeek = calendarWake(now, (1 - now.getDay() + 7) % 7 || 7, 9)
  if (nextWeek.getTime() !== tomorrow.getTime()) {
    const next = preset('next-week', 'Next week', nextWeek)
    result.push({
      ...next,
      whenLabel: `${nextWeek.toLocaleDateString(undefined, { weekday: 'short' })} ${next.whenLabel}`,
    })
  }
  return result
}

function preset(id: string, label: string, date: Date): SnoozePreset {
  return {
    id,
    label,
    whenLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    snoozedUntil: date.toISOString(),
  }
}

function calendarWake(now: Date, days: number, hour: number) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

export type CustomSnoozeInput =
  | { readonly mode: 'date'; readonly date: string; readonly time: string }
  | {
      readonly mode: 'duration'
      readonly amount: string
      readonly unit: 'minutes' | 'hours' | 'days'
    }

export function customSnooze(input: CustomSnoozeInput, now: Date): string | null {
  const date = customSnoozeDate(input, now)
  return date && Number.isFinite(date.getTime()) && date.getTime() > now.getTime()
    ? date.toISOString()
    : null
}

function customSnoozeDate(input: CustomSnoozeInput, now: Date) {
  if (input.mode === 'duration') {
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return new Date(
      now.getTime() + amount * { minutes: 60_000, hours: HOUR, days: DAY }[input.unit],
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null
  const date = new Date(`${input.date}T${input.time}:00`)
  if (localSnoozeDate(date) !== input.date || localSnoozeTime(date) !== input.time) return null
  return date
}

export function localSnoozeDate(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localSnoozeTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
