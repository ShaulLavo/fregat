import { sameUpdateTarget } from '@workspace/contracts'
import type { UpdateIntent } from '@/features/server-update/state/intent'
import { newerUpdateTarget, type ReleaseStatus } from '@/features/server-update/utils/release-ready'

export function reconcileUpdateIntent(
  intent: UpdateIntent,
  status: ReleaseStatus,
): 'idle' | 'staged' | 'served' | 'superseded' | 'gone' {
  if (intent.kind === 'idle') return 'idle'
  const target = intent.target
  if (target.stagedAt === null) {
    if (status.pending || status.release !== target.release) return 'superseded'
    return 'served'
  }
  if (newerUpdateTarget(status.pending, target)) return 'superseded'
  if (sameUpdateTarget(status.pending, target)) return 'staged'
  if (status.release !== null && status.release !== target.release) return 'gone'
  if (status.server.release === target.release) return 'served'
  return 'gone'
}
