import type { Client } from '@workspace/client-core/transport/client'
import { applyReplacement, type ReplacementPlan } from '@/search/state/replacement'

export function checkReplacementOwner(plan: ReplacementPlan, client: Client) {
  // @ts-expect-error A prepared plan cannot be retargeted at confirmation.
  applyReplacement(plan, client)
  // @ts-expect-error Counts and operations alone are not an issued plan.
  applyReplacement({ count: plan.count, operations: plan.operations })
}
