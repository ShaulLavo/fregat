import type {
  ProviderAccountUsage,
  ProviderInstanceId,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@workspace/contracts'
import { formatWait } from '@workspace/utils/timing'

import { formatChatRelativeTime } from '@/features/chat/utils/formatters'

export type UsageTone = 'muted' | 'warning' | 'destructive'

// Codex's own TUI starts warning here; below it a number is information, not a notice.
const WARNING_PERCENT = 75
/** Past this, a reading may no longer describe the account (Codex's `/status` uses 15 minutes). */
const STALE_AFTER_MS = 15 * 60_000

export function accountUsageFor(
  result: ProviderUsageResult | undefined,
  providerInstanceId: ProviderInstanceId | null | undefined,
): ProviderAccountUsage | null {
  if (!result || !providerInstanceId) return null

  const account = result.accounts.find((candidate) =>
    candidate.providerInstanceIds.includes(providerInstanceId),
  )
  if (!account || account.windows.length === 0) return null

  return account
}

/**
 * The provider's status wins: a full window that credits or overage still pay for
 * reports `warning`, and only a refusal is red. The percentage speaks otherwise.
 */
export function usageWindowTone(window: ProviderUsageWindow): UsageTone {
  if (window.status === 'rejected') return 'destructive'
  if (window.status === 'warning') return 'warning'
  if (window.usedPercent >= 100) return 'destructive'
  if (window.usedPercent >= WARNING_PERCENT) return 'warning'

  return 'muted'
}

/** A window whose reset has passed no longer says anything true about the account. */
export function liveUsageWindows(windows: readonly ProviderUsageWindow[], nowMs: number) {
  return windows.filter((window) => !window.resetsAt || Date.parse(window.resetsAt) > nowMs)
}

/** `Checked 4m ago`; past fifteen minutes it says the numbers may have moved. */
export function usageCheckedLabel(checkedAt: string, nowMs: number) {
  const ago = formatChatRelativeTime(checkedAt, nowMs)
  const checked = ago === 'now' ? 'Checked just now' : `Checked ${ago}`
  if (nowMs - Date.parse(checkedAt) <= STALE_AFTER_MS) return checked

  return `${checked} · may be out of date`
}

/** Near a limit a turn can spend the rest in minutes, so a running session reads more often. */
export function usageRefetchIntervalMs(windows: readonly ProviderUsageWindow[]) {
  const tightest = tightestUsageWindow(windows)
  if (tightest && tightest.usedPercent >= 90) return 15_000

  return 60_000
}

const TONE_RANK: Record<UsageTone, number> = { muted: 0, warning: 1, destructive: 2 }

/** The window that will stop the agent first: worst tone, then highest use. */
export function tightestUsageWindow(windows: readonly ProviderUsageWindow[]) {
  let tightest: ProviderUsageWindow | null = null
  for (const window of windows) {
    if (tightest && compareTightness(window, tightest) <= 0) continue

    tightest = window
  }

  return tightest
}

function compareTightness(left: ProviderUsageWindow, right: ProviderUsageWindow) {
  const toneDelta = TONE_RANK[usageWindowTone(left)] - TONE_RANK[usageWindowTone(right)]
  if (toneDelta !== 0) return toneDelta

  return left.usedPercent - right.usedPercent
}

/** Null once the reset has passed or is unknown. */
export function formatResetIn(resetsAt: string | null, nowMs: number) {
  if (!resetsAt) return null

  const waitMs = Date.parse(resetsAt) - nowMs
  if (!Number.isFinite(waitMs) || waitMs <= 0) return null

  return formatWait(waitMs)
}

export const USAGE_TONE_TEXT: Record<UsageTone, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

export const USAGE_TONE_FILL: Record<UsageTone, string> = {
  muted: 'bg-muted-foreground',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

export function usageWindowLabel(window: ProviderUsageWindow, nowMs: number) {
  const used = `${window.label} ${Math.round(window.usedPercent)}% used`
  const resetIn = formatResetIn(window.resetsAt, nowMs)

  return resetIn ? `${used}, resets in ${resetIn}` : used
}

/** Codex plan slugs (`pro`, `self_serve_business_usage_based`) as words. */
export function formatPlanType(planType: string) {
  const words = planType.split('_').join(' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

// Within this many points of even spending reads as "on pace", not a verdict.
const PACE_TOLERANCE = 5

export type UsagePace = {
  /** Share of the window already gone, 0–100; where even spending would stand. */
  elapsedPercent: number
  verdict: 'ahead' | 'on' | 'under'
  /** At the current rate the window runs out this long before it resets; null if it lasts. */
  runsOutInMs: number | null
}

/**
 * Use against time: a window 60% spent with 20% of it gone is ahead of pace and will
 * run out before it resets. Needs the window's length and reset; null without them,
 * and for a window already spent.
 */
export function usagePace(window: ProviderUsageWindow, nowMs: number): UsagePace | null {
  if (!window.resetsAt || !window.windowMinutes) return null
  // A spent window has no pace left to keep; its reset time is the whole story.
  if (window.usedPercent >= 100) return null

  const windowMs = window.windowMinutes * 60_000
  const remainingMs = Date.parse(window.resetsAt) - nowMs
  if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > windowMs) return null

  const elapsedMs = windowMs - remainingMs
  const elapsedPercent = (elapsedMs / windowMs) * 100
  const lead = window.usedPercent - elapsedPercent

  return {
    elapsedPercent,
    runsOutInMs: runsOutBeforeReset(window.usedPercent, elapsedMs, remainingMs),
    verdict: paceVerdict(lead),
  }
}

function paceVerdict(lead: number): UsagePace['verdict'] {
  if (lead > PACE_TOLERANCE) return 'ahead'
  if (lead < -PACE_TOLERANCE) return 'under'

  return 'on'
}

function runsOutBeforeReset(usedPercent: number, elapsedMs: number, remainingMs: number) {
  if (usedPercent <= 0 || usedPercent >= 100 || elapsedMs <= 0) return null

  const msPerPercent = elapsedMs / usedPercent
  const runsOutInMs = (100 - usedPercent) * msPerPercent

  return runsOutInMs < remainingMs ? runsOutInMs : null
}

/** `Ahead of pace · runs out in 2h 10m`, `On pace`, `Under pace`. */
export function usagePaceLabel(pace: UsagePace) {
  if (pace.verdict === 'on') return 'On pace'
  if (pace.verdict === 'under') return 'Under pace'
  if (pace.runsOutInMs === null) return 'Ahead of pace'

  return `Ahead of pace · runs out in ${formatWait(pace.runsOutInMs)}`
}
