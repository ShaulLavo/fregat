import { queryOptions } from '@tanstack/react-query'
import {
  pushDeviceId,
  type PushDeviceRegistration,
  type PushSubscriptionInput,
} from '@workspace/contracts'

import { pushErrors } from '@/features/settings/utils/push-errors'
import {
  deviceLabel,
  pushSupport,
  pushWorkerScript,
  readPushEnvironment,
  type PushSupport,
} from '@/features/settings/utils/push-support'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'

export type ThisDevice = {
  readonly support: PushSupport
  readonly permission: NotificationPermission | null
  /** `pushDeviceId` of this browser's subscription, when it holds one. */
  readonly deviceId: string | null
  readonly applicationServerKey: readonly number[] | null
}

/** This browser's side of push: whether it can, whether it may, and which device it is. */
export function pushThisDeviceQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.pushThisDevice,
    queryFn: readThisDevice,
  })
}

async function readThisDevice(): Promise<ThisDevice> {
  const support = pushSupport(readPushEnvironment())
  if (support !== 'supported')
    return { support, permission: null, deviceId: null, applicationServerKey: null }

  const subscription = await currentSubscription()
  const deviceId = subscription ? await pushDeviceId(subscription.endpoint) : null

  const key = subscription?.options.applicationServerKey
  return {
    support,
    permission: Notification.permission,
    deviceId,
    applicationServerKey: key ? [...new Uint8Array(key)] : null,
  }
}

/** Browsers show the prompt only during a user gesture, so call it first in a click's work. */
export async function requestPushPermission(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission === 'granted') return
  if (permission === 'denied') throw pushErrors.PERMISSION_DENIED({ internal: { permission } })

  throw pushErrors.PERMISSION_DISMISSED({ internal: { permission } })
}

/**
 * Registers the worker and subscribes with the server's key. A subscription is reused only while
 * the server still lists it; one it dropped as expired would be refused again.
 */
export async function subscribeThisDevice(
  publicKey: string,
  registeredIds: readonly string[],
): Promise<PushDeviceRegistration> {
  await navigator.serviceWorker.register(pushWorkerScript(), {
    scope: import.meta.env.BASE_URL,
    updateViaCache: 'none',
  })
  const registration = await navigator.serviceWorker.ready
  const subscription = await subscribeWithKey(
    registration.pushManager,
    base64UrlBytes(publicKey),
    registeredIds,
  )

  return {
    subscription: subscription.toJSON() as PushSubscriptionInput,
    label: deviceLabel(readPushEnvironment()),
  }
}

export async function unsubscribeThisDevice(): Promise<void> {
  const subscription = await currentSubscription()
  await subscription?.unsubscribe()
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!registration) return null

  return registration.pushManager.getSubscription()
}

// A subscription is bound to one server key; an older key's subscription cannot receive this server's pushes.
async function subscribeWithKey(
  manager: PushManager,
  key: Uint8Array<ArrayBuffer>,
  registeredIds: readonly string[],
) {
  const existing = await manager.getSubscription()
  if (existing && (await reusable(existing, key, registeredIds))) return existing

  await existing?.unsubscribe()
  try {
    return await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  } catch (error) {
    if (!(error instanceof Error))
      throw pushErrors.SUBSCRIBE_FAILED({ internal: { errorType: typeof error } })
    throw pushErrors.SUBSCRIBE_FAILED({ cause: error, internal: { errorName: error.name } })
  }
}

async function reusable(
  subscription: PushSubscription,
  key: Uint8Array,
  registeredIds: readonly string[],
) {
  if (!sameBytes(subscription.options.applicationServerKey, key)) return false

  return registeredIds.includes(await pushDeviceId(subscription.endpoint))
}

function sameBytes(left: ArrayBuffer | readonly number[] | null, right: Uint8Array) {
  if (!left) return false
  const bytes = left instanceof ArrayBuffer ? new Uint8Array(left) : left
  if (bytes.length !== right.length) return false
  return bytes.every((byte, index) => byte === right[index])
}

export function deviceUsesPushKey(device: ThisDevice, publicKey: string) {
  return sameBytes(device.applicationServerKey, base64UrlBytes(publicKey))
}

function base64UrlBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))

  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
