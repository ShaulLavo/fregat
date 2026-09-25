import type { SDKControlGetUsageResponse, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import type {
  ProviderUsageWindow,
  ProviderUsageWindowKind,
  ProviderUsageWindowStatus,
} from '@workspace/contracts'
import { formatWait } from '@workspace/utils/timing'
import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from '../adapters/codex-protocol'

/** A reading may know a window's status without its percentage; merge keeps the known one. */
export type ProviderUsageReading = Omit<ProviderUsageWindow, 'usedPercent'> & {
  usedPercent: number | null
}

export type ProviderUsageUpdate = {
  planType: string | null
  windows: ProviderUsageReading[]
}

/** A full read replaces the account's windows; `unsupported` means no plan limits apply. */
export type ProviderUsageProbe =
  | { kind: 'reading'; update: ProviderUsageUpdate }
  | { kind: 'unsupported' }

const SESSION_MINUTES = 5 * 60
const WEEK_MINUTES = 7 * 24 * 60
const MONTH_MINUTES = 30 * 24 * 60

const KIND_LABELS: Record<ProviderUsageWindowKind, string> = {
  session: 'Session',
  weekly: 'Weekly',
  monthly: 'Monthly',
  other: 'Other',
}

/** Both Claude sources name these windows the same way, so a stream event lands on the probe's row. */
/** Claude never states a window's length; its ids do. */
const CLAUDE_WINDOWS: Record<
  string,
  { kind: ProviderUsageWindowKind; label: string; windowMinutes: number }
> = {
  five_hour: { kind: 'session', label: 'Session', windowMinutes: SESSION_MINUTES },
  seven_day: { kind: 'weekly', label: 'Weekly', windowMinutes: WEEK_MINUTES },
  seven_day_opus: { kind: 'weekly', label: 'Weekly · Opus', windowMinutes: WEEK_MINUTES },
  seven_day_sonnet: { kind: 'weekly', label: 'Weekly · Sonnet', windowMinutes: WEEK_MINUTES },
}

const CLAUDE_STATUS: Record<SDKRateLimitInfo['status'], ProviderUsageWindowStatus> = {
  allowed: 'allowed',
  allowed_warning: 'warning',
  rejected: 'rejected',
}

/** The stream names the model-scoped bucket by type; `get_usage` names it by model. */
const CLAUDE_OVERAGE_INCLUDED = 'seven_day_overage_included'

/**
 * One `rate_limit_event` names one window, utilization 0–1 and reset in epoch seconds.
 * A rejection only stops the agent when overage is not paying for it, and only a
 * stopping rejection says the window is spent. `scopedModel` is the name the last
 * `get_usage` gave the overage-included bucket; without it that event is dropped.
 */
export function claudeUsageUpdate(
  info: SDKRateLimitInfo,
  scopedModel: string | null,
): ProviderUsageUpdate {
  const window = claudeEventWindow(info.rateLimitType, scopedModel)
  if (!window) return { planType: null, windows: [] }

  const blocking = claudeBlocksTurn(info)
  const usedPercent =
    typeof info.utilization === 'number' ? clampPercent(info.utilization * 100) : null

  return {
    planType: null,
    windows: [
      {
        ...window,
        resetsAt: isoFromEpochSeconds(info.resetsAt),
        status: blocking ? 'rejected' : claudeCoveredStatus(info),
        usedPercent: blocking && usedPercent === null ? 100 : usedPercent,
      },
    ],
  }
}

export function claudeBlocksTurn(info: SDKRateLimitInfo) {
  if (info.status !== 'rejected') return false

  return !claudeOverageCovers(info)
}

function claudeOverageCovers(info: SDKRateLimitInfo) {
  if (info.isUsingOverage || info.overageInUse) return true

  return info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning'
}

/** A rejection overage pays for still runs, so it reads as a warning, not a stop. */
function claudeCoveredStatus(info: SDKRateLimitInfo): ProviderUsageWindowStatus {
  if (info.status === 'rejected') return 'warning'

  return CLAUDE_STATUS[info.status] ?? 'allowed'
}

/** The window an event names, with the label a pause message uses. */
export function claudeEventWindow(type: string | undefined, scopedModel: string | null) {
  if (!type) return null
  if (type === CLAUDE_OVERAGE_INCLUDED) return scopedModel ? claudeScopedWindow(scopedModel) : null

  const known = CLAUDE_WINDOWS[type]
  return known ? { id: type, ...known } : null
}

function claudeScopedWindow(displayName: string) {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  return {
    id: `seven_day_${slug}`,
    kind: 'weekly' as const,
    label: `Weekly · ${displayName}`,
    windowMinutes: WEEK_MINUTES,
  }
}

/**
 * `get_usage` reports every window at once, 0–100 with ISO resets. The first scoped
 * model that drew a row is the one the stream's overage-included event refers to.
 */
export function claudeUsageProbe(response: SDKControlGetUsageResponse): {
  probe: ProviderUsageProbe
  scopedModel: string | null
} {
  const limits = response.rate_limits
  if (!response.rate_limits_available || !limits) {
    return { probe: { kind: 'unsupported' }, scopedModel: null }
  }

  // Extra usage pays for a spent window, so a full one still runs.
  const covered = Boolean(limits.extra_usage?.is_enabled)
  const windows: ProviderUsageReading[] = []
  for (const [id, window] of Object.entries(CLAUDE_WINDOWS)) {
    const reading = limits[id as keyof typeof limits]
    if (!reading || !('resets_at' in reading) || typeof reading.utilization !== 'number') continue

    windows.push(probeWindow({ id, ...window }, reading.utilization, reading.resets_at, covered))
  }
  let scopedModel: string | null = null
  for (const scoped of limits.model_scoped ?? []) {
    const name = scoped.display_name.trim()
    if (typeof scoped.utilization !== 'number' || !name) continue

    windows.push(
      probeWindow(claudeScopedWindow(name), scoped.utilization, scoped.resets_at, covered),
    )
    scopedModel ??= name
  }
  const extra = limits.extra_usage
  if (extra?.is_enabled && typeof extra.utilization === 'number') {
    // A monthly spend cap, not a rolling window: no length to pace against.
    const window = {
      id: 'extra_usage',
      kind: 'other' as const,
      label: 'Extra usage',
      windowMinutes: null,
    }
    windows.push(probeWindow(window, extra.utilization, null, false))
  }

  return {
    probe: {
      kind: 'reading',
      update: { planType: planLabel(response.subscription_type), windows },
    },
    scopedModel,
  }
}

function probeWindow(
  window: {
    id: string
    kind: ProviderUsageWindowKind
    label: string
    windowMinutes: number | null
  },
  utilization: number,
  resetsAt: string | null,
  covered: boolean,
): ProviderUsageReading {
  const usedPercent = clampPercent(utilization)

  return {
    ...window,
    resetsAt: isoFromString(resetsAt),
    status: spentWindowStatus(usedPercent, covered),
    usedPercent,
  }
}

/**
 * `primary` and `secondary` are positions, not durations. Model-specific snapshots
 * (another `limitId`) describe a different allowance and must not replace the main one.
 * A spent window with credits left still runs, so it warns instead of stopping.
 */
export function codexUsageUpdate(snapshot: CodexRateLimitSnapshot): ProviderUsageUpdate {
  if (snapshot.limitId && snapshot.limitId !== 'codex') return { planType: null, windows: [] }

  const monthlyPlan = snapshot.planType === 'free' || snapshot.planType === 'go'
  const creditsCover = Boolean(snapshot.credits?.hasCredits || snapshot.credits?.unlimited)
  const positions = [
    ['primary', snapshot.primary, monthlyPlan ? MONTH_MINUTES : SESSION_MINUTES],
    ['secondary', snapshot.secondary, WEEK_MINUTES],
  ] as const
  const windows: ProviderUsageReading[] = []
  for (const [id, window, fallbackMinutes] of positions) {
    if (!window || !Number.isFinite(window.usedPercent)) continue

    windows.push(codexWindow(id, window, fallbackMinutes, creditsCover))
  }

  return { planType: planLabel(snapshot.planType), windows }
}

function codexWindow(
  id: string,
  window: CodexRateLimitWindow,
  fallbackMinutes: number,
  creditsCover: boolean,
): ProviderUsageReading {
  const windowMinutes = window.windowDurationMins ?? fallbackMinutes
  const kind = kindForMinutes(windowMinutes)
  const usedPercent = clampPercent(window.usedPercent)

  return {
    id,
    kind,
    windowMinutes,
    label: KIND_LABELS[kind],
    resetsAt: isoFromEpochSeconds(window.resetsAt),
    status: spentWindowStatus(usedPercent, creditsCover),
    usedPercent,
  }
}

// A full read carries no early warning; a spent window is the one state it implies.
function spentWindowStatus(usedPercent: number, covered: boolean) {
  if (usedPercent < 100) return null

  return covered ? 'warning' : 'rejected'
}

function kindForMinutes(minutes: number): ProviderUsageWindowKind {
  if (minutes >= MONTH_MINUTES) return 'monthly'
  if (minutes >= WEEK_MINUTES) return 'weekly'

  return 'session'
}

/**
 * Windows upsert by id; one the update omits keeps its last values, and a reading
 * without a percentage or a reset keeps the known one. A reading with no percentage
 * for a window never seen is dropped. Returns `previous` itself when nothing changed.
 */
export function mergeUsageWindows<Windows extends readonly ProviderUsageWindow[]>(
  previous: Windows,
  update: readonly ProviderUsageReading[],
): Windows | ProviderUsageWindow[] {
  const merged = new Map(previous.map((window) => [window.id, window]))
  let changed = false
  for (const reading of update) {
    const existing = merged.get(reading.id)
    const next = mergedWindow(existing, reading)
    if (!next || (existing && sameWindow(existing, next))) continue

    merged.set(reading.id, next)
    changed = true
  }
  if (!changed) return previous

  return sortUsageWindows([...merged.values()])
}

function mergedWindow(
  existing: ProviderUsageWindow | undefined,
  reading: ProviderUsageReading,
): ProviderUsageWindow | null {
  const usedPercent = reading.usedPercent ?? existing?.usedPercent
  if (usedPercent === undefined) return null

  return {
    ...reading,
    resetsAt: reading.resetsAt ?? existing?.resetsAt ?? null,
    usedPercent,
    windowMinutes: reading.windowMinutes ?? existing?.windowMinutes ?? null,
  }
}

/** A full read: the windows it names, nothing carried over. */
export function probedUsageWindows(update: readonly ProviderUsageReading[]) {
  const windows: ProviderUsageWindow[] = []
  for (const reading of update) {
    const window = mergedWindow(undefined, reading)
    if (window) windows.push(window)
  }

  return sortUsageWindows(windows)
}

const KIND_ORDER: Record<ProviderUsageWindowKind, number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
}

function sortUsageWindows(windows: ProviderUsageWindow[]) {
  return windows.toSorted(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.id.localeCompare(right.id),
  )
}

function sameWindow(left: ProviderUsageWindow, right: ProviderUsageWindow) {
  return (
    left.kind === right.kind &&
    left.label === right.label &&
    left.usedPercent === right.usedPercent &&
    left.resetsAt === right.resetsAt &&
    left.windowMinutes === right.windowMinutes &&
    left.status === right.status
  )
}

/**
 * What a stopped turn tells the user instead of the provider's sentence: which limit,
 * and how long until it resets. `atMs` is when the stop happened, not the wall clock.
 */
export function usageLimitMessage(input: {
  atMs: number
  provider: 'Claude' | 'Codex'
  window: Pick<ProviderUsageWindow, 'label' | 'resetsAt'> | null
}) {
  const wait = resetWait(input.window?.resetsAt ?? null, input.atMs)
  if (!input.window || wait === null) return `${input.provider} usage limit reached.`

  const label = input.window.label.charAt(0).toLowerCase() + input.window.label.slice(1)
  return `${input.provider} usage limit reached. The ${label} limit resets in ${wait}.`
}

// Past, unknown, or implausibly far (a bad epoch) all mean "say nothing about when".
function resetWait(resetsAt: string | null, atMs: number) {
  if (!resetsAt) return null

  const waitMs = Date.parse(resetsAt) - atMs
  if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > MONTH_MINUTES * 60_000) return null

  return formatWait(waitMs)
}

/** The spent window that frees last: until it resets, the agent cannot continue. */
export function stoppingUsageWindow(windows: readonly ProviderUsageWindow[], atMs: number) {
  let stopping: ProviderUsageWindow | null = null
  for (const window of windows) {
    if (!isStoppingWindow(window, atMs)) continue
    if (stopping && resetMs(stopping) >= resetMs(window)) continue

    stopping = window
  }

  return stopping
}

function isStoppingWindow(window: ProviderUsageWindow, atMs: number) {
  if (window.status === 'warning') return false
  if (window.usedPercent < 100 && window.status !== 'rejected') return false

  return resetMs(window) > atMs
}

function resetMs(window: ProviderUsageWindow) {
  return window.resetsAt ? Date.parse(window.resetsAt) : Number.NEGATIVE_INFINITY
}

/** `unknown` and blank plans say nothing a label should repeat. */
function planLabel(planType: string | null | undefined) {
  const trimmed = planType?.trim()
  if (!trimmed || trimmed === 'unknown') return null

  return trimmed
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0

  return Math.min(100, Math.max(0, value))
}

function isoFromEpochSeconds(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null

  return new Date(value * 1000).toISOString()
}

function isoFromString(value: string | null | undefined) {
  if (!value) return null

  const atMs = Date.parse(value)
  return Number.isFinite(atMs) ? new Date(atMs).toISOString() : null
}

/** What the user can do about a Codex stop; a workspace stop is not theirs to wait out alone. */
export function codexLimitNextStep(reachedType: string | null) {
  switch (reachedType) {
    case 'workspace_owner_credits_depleted':
    case 'workspace_member_credits_depleted':
      return 'The workspace has no credits left: ask its owner to add some, or send the message again once the limit resets.'
    case 'workspace_owner_usage_limit_reached':
    case 'workspace_member_usage_limit_reached':
      return 'The workspace spend limit is reached: ask its owner to raise it, or send the message again once the limit resets.'
    default:
      return 'Send the message again once the limit resets.'
  }
}
