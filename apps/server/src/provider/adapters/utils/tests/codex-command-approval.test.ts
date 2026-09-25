import { describe, expect, it } from 'vitest'
import { codexCommandApprovalOffers } from '../codex-command-approval'

function labels(params: unknown) {
  return codexCommandApprovalOffers(params).map((offer) => offer.option.label)
}

describe('codexCommandApprovalOffers', () => {
  it('quotes the amendment so argument boundaries survive in the label', () => {
    const amendment = ['bash', '-lc', 'git status && rm -rf build']
    expect(labels({ proposedExecpolicyAmendment: amendment })).toContain(
      "Always allow commands starting with bash -lc 'git status && rm -rf build'",
    )
  })

  it('shows only what Codex lists, and never a deny rule as an "always allow"', () => {
    const deny = {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: { host: 'example.com', action: 'deny' },
      },
    }
    expect(labels({ availableDecisions: ['accept', deny, 'cancel', 'somethingNew'] })).toEqual([
      'Cancel',
      'Allow',
    ])
  })
})
