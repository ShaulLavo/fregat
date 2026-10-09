import type { ProviderAccountUsage } from '@workspace/contracts'
import { mergeObservedUsageWindows } from './usage-windows'

/** Identity proofs group accounts; labels, mappings and plans never establish equality. */
export function mergeProvenUsageAccounts(
  accounts: readonly ProviderAccountUsage[],
  identities: ReadonlyMap<string, string>,
): ProviderAccountUsage[] {
  const result: ProviderAccountUsage[] = []
  const positions = new Map<string, number>()
  for (const account of accounts) {
    const identity = account.driverKind === 'codex' ? identities.get(account.accountKey) : undefined
    const position = identity ? positions.get(identity) : undefined
    if (position === undefined) {
      if (identity) positions.set(identity, result.length)
      result.push(account)
      continue
    }
    result[position] = mergeAccount(result[position]!, account)
  }
  return result
}

function mergeAccount(
  left: ProviderAccountUsage,
  right: ProviderAccountUsage,
): ProviderAccountUsage {
  let control = right.source === 'cli-proxy-management' ? right : left
  if (
    left.source === 'cli-proxy-management' &&
    (left.state === 'disabled' || (left.state === 'cooldown' && control.state !== 'disabled'))
  )
    control = left
  const newer = latest(left.checkedAt, right.checkedAt) === right.checkedAt ? right : left
  const other = control === left ? right : left
  return {
    ...control,
    ...mergeUsageCredits(left, right),
    resetCredits: newer.resetCredits ?? left.resetCredits ?? right.resetCredits,
    label: control.label ?? newer.label ?? left.label ?? right.label,
    planType: newer.planType ?? control.planType,
    state: control.state === 'no-data' && other.windows.length > 0 ? other.state : control.state,
    checkedAt: latest(left.checkedAt, right.checkedAt),
    lastSeenAt: latest(left.lastSeenAt ?? left.checkedAt, right.lastSeenAt ?? right.checkedAt),
    providerInstanceIds: [...new Set(left.providerInstanceIds.concat(right.providerInstanceIds))],
    windows: mergeObservedUsageWindows(left.windows, right.windows),
  }
}

export function mergeUsageCredits(left: ProviderAccountUsage, right: ProviderAccountUsage) {
  let selected = left
  if (left.credits === undefined) selected = right
  else if (right.credits !== undefined && newerCredits(left, right)) selected = right
  return { credits: selected.credits, creditsObservedAt: selected.creditsObservedAt }
}

function newerCredits(left: ProviderAccountUsage, right: ProviderAccountUsage) {
  const leftAt = left.creditsObservedAt
    ? Date.parse(left.creditsObservedAt)
    : Number.NEGATIVE_INFINITY
  const rightAt = right.creditsObservedAt
    ? Date.parse(right.creditsObservedAt)
    : Number.NEGATIVE_INFINITY
  if (leftAt !== rightAt) return rightAt > leftAt
  if (right.credits === null) return left.credits !== null
  if (left.credits === null) return false
  if (left.credits?.unlimited !== right.credits?.unlimited) return !right.credits?.unlimited
  return (
    (right.credits?.balance ?? Number.POSITIVE_INFINITY) <
    (left.credits?.balance ?? Number.POSITIVE_INFINITY)
  )
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) > Date.parse(right) ? left : right
}
