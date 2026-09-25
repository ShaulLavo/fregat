import * as v from 'valibot'
import type { ProviderApprovalDecision } from '@workspace/contracts'
import { shellQuote } from '../../../utils/shell'
import type { ApprovalOffer } from './approval-offers'

// Wire shapes from codex-rs app-server-protocol v2 `CommandExecutionApprovalDecision`.
const execpolicySchema = v.object({
  acceptWithExecpolicyAmendment: v.object({ execpolicy_amendment: v.array(v.string()) }),
})
const networkSchema = v.object({
  applyNetworkPolicyAmendment: v.object({
    network_policy_amendment: v.object({ host: v.string(), action: v.string() }),
  }),
})
// Each entry is parsed on its own, so one decision this build does not know drops only itself.
const paramsSchema = v.object({
  proposedExecpolicyAmendment: v.nullish(v.array(v.string())),
  availableDecisions: v.nullish(v.array(v.unknown())),
})

export type CodexCommandOffer = ApprovalOffer<{ decision: unknown }>

const SIMPLE_LABELS = new Map<unknown, [ProviderApprovalDecision, string]>([
  ['cancel', ['cancel', 'Cancel']],
  ['decline', ['decline', 'Deny']],
  ['acceptForSession', ['acceptForSession', 'Allow for this session']],
  ['accept', ['accept', 'Allow']],
])
// Our order, whatever order Codex lists them in: the safe choices first, the one-off last.
const DECISION_ORDER: readonly ProviderApprovalDecision[] = [
  'cancel',
  'decline',
  'acceptForSession',
  'acceptAlways',
  'accept',
]

/**
 * Codex lists the decisions it accepts; anything outside that list would be refused, so it is
 * never shown. Older servers send no list, and then only the proposed amendment adds a rule.
 */
export function codexCommandApprovalOffers(params: unknown): readonly CodexCommandOffer[] {
  const parsed = v.safeParse(paramsSchema, params)
  if (!parsed.success) return legacyOffers(null)
  const { availableDecisions, proposedExecpolicyAmendment } = parsed.output
  if (!availableDecisions) return legacyOffers(proposedExecpolicyAmendment ?? null)

  const offers = new Map<ProviderApprovalDecision, CodexCommandOffer>()
  for (const decision of availableDecisions) {
    const offer = offerFor(decision)
    // One "always" slot: the first rule Codex lists wins it.
    if (!offer || offers.has(offer.option.decision)) continue
    offers.set(offer.option.decision, offer)
  }
  return DECISION_ORDER.flatMap((decision) => offers.get(decision) ?? [])
}

function offerFor(decision: unknown): CodexCommandOffer | null {
  const simple = SIMPLE_LABELS.get(decision)
  if (simple) return { option: { decision: simple[0], label: simple[1] }, response: { decision } }
  const execpolicy = v.safeParse(execpolicySchema, decision)
  if (execpolicy.success) {
    const amendment = execpolicy.output.acceptWithExecpolicyAmendment.execpolicy_amendment
    if (amendment.length === 0) return null
    return alwaysOffer(execpolicyLabel(amendment), decision)
  }
  const network = v.safeParse(networkSchema, decision)
  if (!network.success) return null
  const { host, action } = network.output.applyNetworkPolicyAmendment.network_policy_amendment
  // A deny rule is not an approval; offering it as "always allow" would invert it.
  if (action !== 'allow') return null
  return alwaysOffer(`Always allow network access to ${host}`, decision)
}

function legacyOffers(amendment: string[] | null): readonly CodexCommandOffer[] {
  const decisions: unknown[] = ['cancel', 'decline', 'acceptForSession']
  if (amendment && amendment.length > 0)
    decisions.push({ acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } })
  decisions.push('accept')
  return decisions.flatMap((decision) => offerFor(decision) ?? [])
}

/** Codex writes the amendment to its own user rules, so "always" means everywhere. */
function alwaysOffer(label: string, decision: unknown): CodexCommandOffer {
  return { option: { decision: 'acceptAlways', label }, response: { decision } }
}

// Quoted like a shell would read it: the rule is a prefix of argv, and a joined string hides where one argument ends.
function execpolicyLabel(amendment: readonly string[]) {
  const words = amendment.map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : shellQuote(word)))
  return `Always allow commands starting with ${words.join(' ')}`
}
