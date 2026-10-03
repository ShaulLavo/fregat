import { sameUpdateTarget, type LiveCheckVerdict, type StagedRelease } from '@workspace/contracts'
import type { UpdateTarget } from '@/features/server-update/state/intent'

export type ReleaseStatus = {
  readonly release: string | null
  readonly server: { readonly release: string | null }
  readonly pending: StagedRelease | null
  readonly liveCheck: LiveCheckVerdict | null
  readonly liveCheckRequired: boolean
}

export function releaseReadyForReload(status: ReleaseStatus, target: UpdateTarget): boolean {
  if (status.release !== target.release) return false
  if (target.stagedAt === null) return true
  if (newerUpdateTarget(status.pending, target)) return false
  if (status.server.release !== target.release) return false
  const freshVerdict =
    status.liveCheck?.release === target.release &&
    Date.parse(status.liveCheck.at) >= Date.parse(target.stagedAt)
  if (freshVerdict && status.liveCheck?.status === 'failed') return false
  if (!status.liveCheckRequired) return true
  return (
    status.liveCheck?.release === target.release &&
    status.liveCheck?.status === 'passed' &&
    freshVerdict
  )
}

/** An older descriptor can still be cached when a newer staging push arrives. */
export function newerUpdateTarget(
  pending: StagedRelease | null | undefined,
  target: UpdateTarget,
): boolean {
  if (!pending || target.stagedAt === null || sameUpdateTarget(pending, target)) return false
  return Date.parse(pending.stagedAt) >= Date.parse(target.stagedAt)
}
