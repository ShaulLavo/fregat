import {
  scopedProjectKey,
  scopedSessionKey,
  type ScopedProjectRef,
  type ScopedSessionRef,
} from '@workspace/contracts'
import { createIntentQueue } from '@workspace/client-core/optimistic/queue'
import { projectIntents } from '@workspace/client-core/optimistic/projection'
import type { RailOrderOverrides } from '@workspace/client-core/chat/rail/model'
import { watchIntentHolds } from '@/lib/optimistic/hold-diagnostics'

/** One drop the server has not confirmed yet. */
export type RailPlacement =
  | { readonly kind: 'project'; readonly ref: ScopedProjectRef; readonly orderKey: string }
  | { readonly kind: 'session'; readonly ref: ScopedSessionRef; readonly orderKey: string }

export const railOrderIntents = watchIntentHolds(createIntentQueue<RailPlacement>(), {
  area: 'chat-rail',
  describe: (placement) => `${placement.kind} ${placement.orderKey}`,
})

const NO_OVERRIDES: RailOrderOverrides = { projectOrderKeys: {}, sessionOrderKeys: {} }

let cachedActive = railOrderIntents.getState().active
let cachedOverrides = NO_OVERRIDES

/**
 * The pending placements as the rail model reads them. Identity-stable while
 * the queue's active list is unchanged, so it can back `useSyncExternalStore`.
 */
export function railOrderOverrides(): RailOrderOverrides {
  const { active } = railOrderIntents.getState()
  if (active === cachedActive) return cachedOverrides

  cachedActive = active
  cachedOverrides = projectIntents(NO_OVERRIDES, active, applyPlacement)
  return cachedOverrides
}

export function railPlacementResource(placement: RailPlacement) {
  if (placement.kind === 'project') return `project:${scopedProjectKey(placement.ref)}`
  return `session:${scopedSessionKey(placement.ref)}`
}

export function resetRailOrderIntents() {
  railOrderIntents.reset()
}

function applyPlacement(
  overrides: RailOrderOverrides,
  placement: RailPlacement,
): RailOrderOverrides {
  if (placement.kind === 'project') {
    return {
      ...overrides,
      projectOrderKeys: {
        ...overrides.projectOrderKeys,
        [scopedProjectKey(placement.ref)]: placement.orderKey,
      },
    }
  }

  return {
    ...overrides,
    sessionOrderKeys: {
      ...overrides.sessionOrderKeys,
      [scopedSessionKey(placement.ref)]: placement.orderKey,
    },
  }
}
