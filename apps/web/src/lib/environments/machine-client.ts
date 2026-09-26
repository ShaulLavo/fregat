import * as v from 'valibot'
import {
  machineConnectionStateSchema,
  machineEventSchema,
  type MachineAuthPrompt,
} from '@workspace/contracts'
import { parseEdenSseStream, requireEdenData } from '@workspace/client-core/transport/eden'
import { environmentClientFor, primaryServerOrigin } from '@/lib/client'
import { clientInstanceId, instanceHeaderName } from '@/lib/instance-id'

function requestOptions(signal?: AbortSignal) {
  return { headers: { [instanceHeaderName]: clientInstanceId() }, fetch: { signal } }
}

export async function fetchSshHosts(signal: AbortSignal) {
  const client = environmentClientFor(primaryServerOrigin())
  const response = await client.machines['ssh-hosts'].get(requestOptions(signal))
  return requireEdenData(response).hosts
}

export async function fetchTailnetHosts(signal: AbortSignal) {
  const client = environmentClientFor(primaryServerOrigin())
  return requireEdenData(await client.machines['tailnet-hosts'].get(requestOptions(signal)))
}

export async function connectSshMachine(name: string, signal: AbortSignal) {
  const client = environmentClientFor(primaryServerOrigin())
  const response = await client.machines({ name }).connect.post({}, requestOptions(signal))
  const state = v.parse(machineConnectionStateSchema, requireEdenData(response))
  if (state.phase !== 'live') return state
  return { ...state, origin: `${primaryServerOrigin()}${state.origin}` }
}

/** Installs the primary's server release on the machine, restarts it and connects again. */
export async function updateSshServer(name: string) {
  const client = environmentClientFor(primaryServerOrigin())
  const response = await client.machines({ name }).update.post({}, requestOptions())
  return v.parse(machineConnectionStateSchema, requireEdenData(response))
}

export async function disconnectSshMachine(name: string) {
  const client = environmentClientFor(primaryServerOrigin())
  requireEdenData(await client.machines({ name }).disconnect.post({}, requestOptions()))
}

export async function answerMachineAuth(
  prompt: MachineAuthPrompt,
  response: string | null,
  signal?: AbortSignal,
) {
  const client = environmentClientFor(primaryServerOrigin())
  requireEdenData(
    await client
      .machines({ name: prompt.name })
      .auth.post({ id: prompt.id, response }, requestOptions(signal)),
  )
}

export async function* subscribeMachineEvents(signal: AbortSignal) {
  const client = environmentClientFor(primaryServerOrigin())
  const response = await client.machines.events.get(requestOptions(signal))
  for await (const event of parseEdenSseStream(requireEdenData(response))) {
    if (event.event !== 'machine') continue
    yield v.parse(machineEventSchema, event.data)
  }
}
