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
    resetCredits: newer.resetCredits ?? left.resetCredits ?? right.resetCredits,
    label: control.label ?? newer.label ?? left.label ?? right.label,
    planType: newer.planType ?? control.planType,
    state: control.state === 'no-data' && other.windows.length > 0 ? other.state : control.state,
    checkedAt: latest(left.checkedAt, right.checkedAt),
    lastSeenAt: latest(left.lastSeenAt ?? left.checkedAt, right.lastSeenAt ?? right.checkedAt),
    providerInstanceIds: [...new Set([...left.providerInstanceIds, ...right.providerInstanceIds])],
    windows: mergeObservedUsageWindows(left.windows, right.windows),
  }
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) > Date.parse(right) ? left : right
}
