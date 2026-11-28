import { readEnvironmentDescriptor as readDescriptor } from '@workspace/client-core/environments/descriptor'
import { environmentClientFor, type Client } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

export function readEnvironmentDescriptor(
  origin: string,
  signal: AbortSignal,
  client: Client = environmentClientFor(origin),
) {
  return readDescriptor({ origin, signal, client, environments: useEnvironmentsStore })
}
