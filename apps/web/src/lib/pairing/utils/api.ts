import { mutationOptions } from '@tanstack/react-query'
import type { PairingClaim } from '@workspace/contracts'

import { getClient } from '@/lib/client'
import { createRpcError } from '@/lib/structured-errors'
import { pairingMutationKeys } from '@/lib/pairing/utils/mutation-keys'

/** Trades a pairing code for this device's cookie; the server sets it, so no script can read it. */
export function claimPairingMutationOptions() {
  return mutationOptions({
    mutationKey: pairingMutationKeys.claim,
    mutationFn: async (claim: PairingClaim) => {
      const { data, error } = await getClient().pairing.claim.post(claim)
      if (error || !data) throw createRpcError(error)
      return data
    },
  })
}
