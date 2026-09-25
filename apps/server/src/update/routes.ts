import { serverRestartInputSchema, type ServerRestartResult } from '@workspace/contracts'
import { Elysia } from 'elysia'

import type { ServerUpdate } from './service'

// Behind the auth guard: a restart interrupts running sessions.
export function serverUpdateRoutes(update: Pick<ServerUpdate, 'requestRestart'>) {
  return new Elysia({ name: 'server-update-routes' }).post(
    '/server/restart',
    ({ body, request }): Promise<ServerRestartResult> =>
      update.requestRestart(
        body.interrupt,
        request.headers.get('x-client-instance')?.slice(0, 64) ?? null,
      ),
    { body: serverRestartInputSchema },
  )
}
