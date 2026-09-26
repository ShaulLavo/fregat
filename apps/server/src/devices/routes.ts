import {
  pairedDevicesSchema,
  pairingClaimSchema,
  pairingLinkSchema,
  pairingStatusSchema,
} from '@workspace/contracts'
import { Elysia } from 'elysia'
import * as v from 'valibot'

import { originGuard, type AuthConfig } from '../auth'
import { FsError } from '../fs/errors'
import { recordRequestContext } from '../observability'
import type { DevicePairing } from './service'
import { pairingErrors } from './structured-errors'
import { headersReader } from './trust'

/**
 * Behind the origin allowlist only: an unpaired device must reach status and claim to pair. The
 * other routes check pairing themselves.
 */
export function pairingRoutes(pairing: DevicePairing, auth: AuthConfig) {
  function admitted(request: Request) {
    const admission = pairing.admit(headersReader(request.headers))
    if (admission.trust === 'unpaired' && pairing.isRequired())
      throw new FsError('DEVICE_NOT_PAIRED')
    return admission
  }

  return new Elysia({ name: 'pairing-routes' })
    .onBeforeHandle(originGuard(auth))
    .get(
      '/pairing/status',
      ({ request }) => {
        recordRequestContext({ area: 'pairing', operation: 'status' })
        const { trust } = pairing.admit(headersReader(request.headers))
        return { trust, required: pairing.isRequired() }
      },
      { response: pairingStatusSchema },
    )
    .post(
      '/pairing/claim',
      ({ body, request, set }) => {
        recordRequestContext({ area: 'pairing', operation: 'claim' })
        const claim = v.safeParse(pairingClaimSchema, body)
        if (!claim.success)
          throw pairingErrors.CODE_INVALID({ internal: { reason: 'malformed-claim' } })
        const { deviceId, cookie } = pairing.claim(claim.output, isSecure(request))
        set.headers['set-cookie'] = cookie
        return { deviceId }
      },
      // No body schema: Elysia's validation error echoes the body, and the code is a credential.
      { response: v.object({ deviceId: v.string() }) },
    )
    .post(
      '/pairing/links',
      ({ request }) => {
        recordRequestContext({ area: 'pairing', operation: 'issue_link' })
        return pairing.issueLink(headersReader(request.headers))
      },
      { response: pairingLinkSchema },
    )
    .get(
      '/pairing/devices',
      ({ request }) => {
        recordRequestContext({ area: 'pairing', operation: 'list_devices' })
        return { devices: pairing.list(admitted(request).deviceId) }
      },
      { response: pairedDevicesSchema },
    )
    .delete(
      '/pairing/devices/:id',
      ({ params, request }) => {
        recordRequestContext({ area: 'pairing', operation: 'remove_device' })
        pairing.revoke(params.id, admitted(request).deviceId)
        return { removed: true }
      },
      { response: v.object({ removed: v.boolean() }) },
    )
}

function isSecure(request: Request) {
  return request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https:')
}
