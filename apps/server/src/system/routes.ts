import { Elysia } from 'elysia'
import * as v from 'valibot'
import { IDENTITY_PROOF_HEADER } from './identity-key'
import type { SystemService } from './service'

const identityQuerySchema = v.object({
  challenge: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,128}$/))),
})

export function systemRoutes(system: SystemService) {
  return new Elysia({ name: 'system-routes' })
    .get(
      '/system/identity',
      ({ request, server, query, set }) => {
        system.requireLocal(request, server)
        const proof = query.challenge ? system.proof(query.challenge) : null
        if (proof) set.headers[IDENTITY_PROOF_HEADER] = proof
        return system.identity()
      },
      { query: identityQuerySchema },
    )
    .get('/system/capabilities', ({ request, server }) => system.capabilities(request, server))
}
