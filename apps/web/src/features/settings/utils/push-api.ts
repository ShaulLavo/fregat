import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { PushDevice, PushDeviceRegistration, PushDevices } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'

/** The devices this server pushes to, and the VAPID key a browser subscribes with. */
export function pushDevicesQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.pushDevices,
    queryFn: ({ client }) => fetchPushDevices(clientForQueryClient(client)),
  })
}

async function fetchPushDevices(client: Client): Promise<PushDevices> {
  const { data, error } = await client.push.devices.get()
  if (error || !data) throw createRpcError(error)

  return data
}

export async function registerPushDevice(
  client: Client,
  registration: PushDeviceRegistration,
): Promise<PushDevice> {
  const { data, error } = await client.push.devices.post(registration)
  if (error || !data) throw createRpcError(error)

  return data.device
}

export async function removePushDevice(client: Client, id: string): Promise<boolean> {
  const { data, error } = await client.push.devices({ id }).delete()
  if (error || !data) throw createRpcError(error)

  return data.removed
}

export async function sendPushTest(client: Client, id: string): Promise<number> {
  const { data, error } = await client.push.devices({ id }).test.post()
  if (error || !data) throw createRpcError(error)

  return data.status
}

/** Every push effect can change both halves: the server's list and this browser's subscription. */
export function settlePushQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.pushDevices }),
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.pushThisDevice }),
  ])
}
