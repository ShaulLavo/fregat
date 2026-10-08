import { test, expect } from '../../../../test/fixtures'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { claimPairingMutationOptions, pairingStatusQueryOptions } from '@/lib/pairing/utils/api'

test('a claimed code settles the pairing status Settings reads to offer Pair a device', async ({
  client,
}) => {
  const queryClient = primaryQueryClient()
  const status = pairingStatusQueryOptions()
  queryClient.setQueryData(status.queryKey, { trust: 'unpaired', required: true, machine: 'm' })
  const { data } = await client.pairing.links.post()

  await runMutation(queryClient, claimPairingMutationOptions(), {
    code: data!.code,
    label: 'iPhone · Safari',
  })

  expect(queryClient.getQueryState(status.queryKey)?.isInvalidated).toBe(true)
})
