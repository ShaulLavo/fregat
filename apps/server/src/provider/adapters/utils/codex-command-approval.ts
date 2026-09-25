import * as v from 'valibot'
import {
  DEFAULT_APPROVAL_OPTIONS,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from '@workspace/contracts'

const paramsSchema = v.object({
  proposedExecpolicyAmendment: v.nullish(v.array(v.string())),
})

/** The command prefix Codex proposes to allow from now on, or `null` when it proposes none. */
export function codexExecpolicyAmendment(params: unknown): readonly string[] | null {
  const parsed = v.safeParse(paramsSchema, params)
  const amendment = parsed.success ? parsed.output.proposedExecpolicyAmendment : null
  if (!amendment || amendment.length === 0) return null

  return amendment
}

/** "Always" is offered only with an amendment: without one Codex has no rule to write. */
export function codexCommandApprovalOptions(
  amendment: readonly string[] | null,
): readonly ProviderApprovalOption[] {
  if (!amendment) return DEFAULT_APPROVAL_OPTIONS

  return [
    { decision: 'cancel', label: 'Cancel' },
    { decision: 'decline', label: 'Deny' },
    { decision: 'acceptForSession', label: 'Allow for this session' },
    { decision: 'acceptAlways', label: `Always allow "${amendment.join(' ')}"` },
    { decision: 'accept', label: 'Allow' },
  ]
}

/** Codex writes the amendment to its own user rules, so "always" means everywhere. */
export function codexCommandApprovalDecision(
  decision: ProviderApprovalDecision,
  amendment: readonly string[] | null,
) {
  if (decision !== 'acceptAlways' || !amendment) return decision

  return { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } }
}
