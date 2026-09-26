import { machineAuthResponseSchema, machineConnectionStateSchema } from '@workspace/contracts'
import { Elysia } from 'elysia'
import * as v from 'valibot'
import { recordRequestContext } from '../observability'
import { sseResponse, toSse } from '../sse'
import type { MachineService } from './service'
import { discoverSshHosts, type SshConfigDirectories } from './ssh-hosts'
import { createSshError } from './structured-errors'
import {
  discoverTailnetHosts,
  tailnetDiscoverySchema,
  type TailnetStatusCommand,
} from './tailnet-hosts'

export function machineRoutes(
  machines: MachineService,
  sshConfig: SshConfigDirectories,
  tailnetStatusCommand?: TailnetStatusCommand,
) {
  return new Elysia({ name: 'machine-routes' })
    .get(
      '/machines/tailnet-hosts',
      async () => {
        recordRequestContext({ area: 'machines', operation: 'discover_tailnet_hosts' })
        return discoverTailnetHosts(tailnetStatusCommand)
      },
      { response: tailnetDiscoverySchema },
    )
    .get(
      '/machines/ssh-hosts',
      async () => {
        recordRequestContext({ area: 'machines', operation: 'discover_ssh_hosts' })
        return { hosts: await discoverSshHosts(sshConfig) }
      },
      { response: v.object({ hosts: v.array(v.string()) }) },
    )
    .post(
      '/machines/:name/connect',
      ({ params, request, server }) => {
        server?.timeout(request, 0)
        recordRequestContext({ area: 'machines', operation: 'connect', machine: params.name })
        return machines.connect(params.name, clientId(request))
      },
      { response: machineConnectionStateSchema },
    )
    .post(
      '/machines/:name/update',
      ({ params, request, server }) => {
        server?.timeout(request, 0)
        recordRequestContext({ area: 'machines', operation: 'update', machine: params.name })
        return machines.update(params.name, clientId(request))
      },
      { response: machineConnectionStateSchema },
    )
    .post('/machines/:name/disconnect', async ({ params, request, server }) => {
      server?.timeout(request, 0)
      recordRequestContext({ area: 'machines', operation: 'disconnect', machine: params.name })
      await machines.disconnect(params.name, clientId(request))
      return { ok: true }
    })
    .post('/machines/:name/auth', async ({ params, body, request }) => {
      recordRequestContext({ area: 'machines', operation: 'authenticate', machine: params.name })
      const parsed = v.safeParse(machineAuthResponseSchema, body)
      if (!parsed.success) throw createSshError('probe', 'Invalid authentication response.')
      await machines.respond(
        params.name,
        clientId(request),
        parsed.output.id,
        parsed.output.response,
      )
      return { ok: true }
    })
    .get('/machines/events', ({ request }) =>
      sseResponse(
        toSse(machines.changes(clientId(request), request.signal), {
          event: () => 'machine',
        }),
        request.signal,
      ),
    )
}

function clientId(request: Request) {
  const value = request.headers.get('x-client-instance')
  if (!value || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw createSshError('settings', 'The connection needs a valid client instance identifier.')
  return value
}
