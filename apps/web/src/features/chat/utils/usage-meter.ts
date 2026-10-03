import type { ProviderAccountUsage, ProviderUsageWindow } from '@workspace/contracts'
import { usageWindowIsCurrent } from '@/lib/provider-usage'

export type UsageTone = 'muted' | 'warning' | 'destructive'

// Codex's own TUI starts warning here; below it a number is information, not a notice.
const WARNING_PERCENT = 75

/** Provider refusal wins over utilization: credits can cover a full window. */
export function usageWindowTone(window: ProviderUsageWindow): UsageTone {
  if (window.status === 'rejected') return 'destructive'
  if (window.status === 'warning') return 'warning'
  if (window.usedPercent !== null && window.usedPercent >= 100) return 'destructive'
  if (window.usedPercent !== null && window.usedPercent >= WARNING_PERCENT) return 'warning'

  return 'muted'
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

  if (left.usedPercent === right.usedPercent) return 0
  if (left.usedPercent === null) return -1
  if (right.usedPercent === null) return 1
  return left.usedPercent - right.usedPercent
}

export function composerUsageReadout(
  accounts: readonly ProviderAccountUsage[],
  nowMs: number,
  staleAfterMs: number,
) {
  if (accounts.length === 0) return 'Unknown'
  if (accounts.length !== 1) return `${accounts.length} accounts`
  const current = accounts[0]!.windows.filter((window) =>
    usageWindowIsCurrent(window, nowMs, staleAfterMs),
  )
  const tightest = tightestUsageWindow(current)
  if (!tightest || tightest.usedPercent === null) return 'Unknown'
  return `${Math.round(tightest.usedPercent)}%`
}
