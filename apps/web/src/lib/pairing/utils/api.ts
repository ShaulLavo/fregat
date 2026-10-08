import { mutationOptions, queryOptions } from '@tanstack/react-query'
import type { PairingClaim } from '@workspace/contracts'

import { getClient } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { pairingMutationKeys } from '@/lib/pairing/utils/mutation-keys'
import { pairingQueryKeys } from '@/lib/pairing/utils/query-keys'

/** Whether this browser is the machine itself, a paired device, or neither, and the machine's name. */
export function pairingStatusQueryOptions() {
  return queryOptions({
    queryKey: pairingQueryKeys.status,
    queryFn: async ({ client }) => {
      const { data, error } = await clientForQueryClient(client).pairing.status.get()
      if (error || !data) throw createRpcError(error)
      return data
    },
  })
}

/** Trades a pairing code for this device's cookie; the server sets it, so no script can read it. */
export function claimPairingMutationOptions() {
  return mutationOptions({
    mutationKey: pairingMutationKeys.claim,
    mutationFn: async (claim: PairingClaim, context) => {
      const { data, error } = await getClient().pairing.claim.post(claim)
      if (error || !data) throw createRpcError(error)
      // Settings reads the same status to offer Pair a device; it is stale once this device pairs.
      await context.client.invalidateQueries({ queryKey: pairingQueryKeys.status })
      return data
    },
  })
}
