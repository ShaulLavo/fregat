import type { OrchestrationProposedPlan } from '@workspace/contracts'
import { createContext } from 'react'

/**
 * The follow-up a finished plan is waiting for. Plan mode only pays off if the
 * plan can be acted on in one click, so this exposes the act itself rather than
 * the composer state behind it: what the turn says, and whether it carries the
 * plan, is decided from the live draft at dispatch time.
 */
export type ChatPlanFollowUp = {
  readonly disabledReason: string | null
  /**
   * Builds the plan in a session of its own, in the same project, and hands the
   * stage over to it. True once the bootstrap turn is accepted.
   */
  readonly implementInNewSession: () => Promise<boolean>
  /** The plan still waiting to be acted on, or null when there is nothing to follow up. */
  readonly plan: OrchestrationProposedPlan | null
  /** True once the turn command is accepted. */
  readonly submitFollowUp: () => Promise<boolean>
  readonly submitting: boolean
}

export const ChatPlanFollowUpContext = createContext<ChatPlanFollowUp | null>(null)
