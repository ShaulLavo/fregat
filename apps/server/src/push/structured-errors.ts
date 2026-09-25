import { defineErrorCatalog } from 'evlog'

export const pushErrors = defineErrorCatalog('push', {
  DEVICE_NOT_FOUND: {
    status: 404,
    message: 'That device is not registered for push notifications',
    why: 'It was removed, or it registered with another server.',
    fix: 'Refresh the device list, then turn push notifications on again on that device.',
  },
  SUBSCRIPTION_INVALID: {
    status: 400,
    message: 'The browser sent a push subscription this server cannot use',
    why: 'Web Push needs an https endpoint, a P-256 public key, a 16-byte auth secret and a device label of at most 80 characters.',
    fix: 'Turn push notifications on again in this browser. If it repeats, use a current Chrome, Edge, Firefox or Safari.',
  },
  SUBSCRIPTION_EXPIRED: {
    status: 410,
    message: 'The push service no longer accepts this device',
    why: 'The browser dropped or replaced its subscription, so its push service answered 404 or 410.',
    fix: 'Remove the device, then turn push notifications on again on it.',
  },
  PUSH_SERVICE_REJECTED: {
    status: 502,
    message: ({ answer }: { answer: number }) =>
      `The push service refused the notification (HTTP ${answer})`,
    why: 'A 401 or 403 means it rejected this server’s signature, 413 a payload that is too large, 429 too many pushes.',
    fix: 'Send the test again in a minute. If it keeps failing, remove the device and turn push notifications on again on it.',
  },
  PUSH_SERVICE_UNREACHABLE: {
    status: 502,
    message: 'The push service could not be reached',
    why: 'The request to the device’s push service failed before any answer arrived.',
    fix: 'Check that this server can reach the internet, then send the test again.',
  },
})
