import { pushDeviceSchema, pushDevicesSchema, pushTestResultSchema } from '@workspace/contracts'
import { Elysia } from 'elysia'
import * as v from 'valibot'
import { recordRequestContext } from '../observability'
import type { PushService } from './service'

export function pushRoutes(push: PushService) {
  return new Elysia({ name: 'push-routes' })
    .get(
      '/push/devices',
      () => {
        recordRequestContext({ area: 'push', operation: 'list_devices' })
        return push.list()
      },
      { response: pushDevicesSchema },
    )
    .post(
      '/push/devices',
      async ({ body, request }) => {
        recordRequestContext({ area: 'push', operation: 'register_device' })
        return { device: await push.register(body, request.headers.get('origin')) }
      },
      // No body schema: Elysia's validation error echoes the body, which carries the subscription keys.
      { response: v.object({ device: pushDeviceSchema }) },
    )
    .delete(
      '/push/devices/:id',
      ({ params }) => {
        recordRequestContext({ area: 'push', operation: 'remove_device' })
        return push.remove(params.id)
      },
      { response: v.object({ removed: v.boolean() }) },
    )
    .post(
      '/push/devices/:id/test',
      ({ params }) => {
        recordRequestContext({ area: 'push', operation: 'send_test' })
        return push.sendTest(params.id)
      },
      { response: pushTestResultSchema },
    )
}
