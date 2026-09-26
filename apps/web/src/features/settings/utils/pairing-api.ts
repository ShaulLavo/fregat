import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { PairedDevice, PairingLink, PairingStatus } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'

/** Whether this browser is the machine itself, a paired device, or neither. */
export function pairingStatusQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.pairingStatus,
    queryFn: ({ client }) => fetchPairingStatus(clientForQueryClient(client)),
  })
}

export function pairedDevicesQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.pairedDevices,
    queryFn: ({ client }) => fetchPairedDevices(clientForQueryClient(client)),
  })
}

async function fetchPairingStatus(client: Client): Promise<PairingStatus> {
  const { data, error } = await client.pairing.status.get()
  if (error || !data) throw createRpcError(error)
  return data
}

async function fetchPairedDevices(client: Client): Promise<readonly PairedDevice[]> {
  const { data, error } = await client.pairing.devices.get()
  if (error || !data) throw createRpcError(error)
  return data.devices
}

export async function issuePairingLink(client: Client): Promise<PairingLink> {
  const { data, error } = await client.pairing.links.post()
  if (error || !data) throw createRpcError(error)
  return data
}

export async function removePairedDevice(client: Client, id: string) {
  const { data, error } = await client.pairing.devices({ id }).delete()
  if (error || !data) throw createRpcError(error)
  return data.removed
}

/** A removal settles the list from the server; the socket carries nothing for it. */
export function settlePairedDevices(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: settingsQueryKeys.pairedDevices })
}
