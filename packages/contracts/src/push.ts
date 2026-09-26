import * as v from 'valibot'
import type { SessionId } from './chat-ids'
import { isoDateTimeSchema, trimmedNonEmptyStringSchema } from './chat-model'
import type { WorkspaceAddress } from './workspace-address'

const base64UrlKeySchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+={0,2}$/), v.maxLength(128))

/** `PushSubscription.toJSON()` as every browser sends it. The server checks the decoded key sizes. */
export const pushSubscriptionSchema = v.object({
  endpoint: v.pipe(v.string(), v.url(), v.maxLength(2048)),
  keys: v.object({ p256dh: base64UrlKeySchema, auth: base64UrlKeySchema }),
})

export const pushDeviceRegistrationSchema = v.object({
  subscription: pushSubscriptionSchema,
  label: v.pipe(trimmedNonEmptyStringSchema, v.maxLength(80)),
})

/** Who runs the endpoint. It is all a log or the device list says about one. */
export const pushServiceSchema = v.picklist(['apple', 'google', 'mozilla', 'microsoft', 'other'])

export const pushDeviceSchema = v.object({
  id: v.string(),
  label: v.string(),
  service: pushServiceSchema,
  createdAt: isoDateTimeSchema,
})

export const pushDevicesSchema = v.object({
  /** The VAPID public key, base64url: the `applicationServerKey` a browser subscribes with. */
  publicKey: v.string(),
  devices: v.array(pushDeviceSchema),
})

export const pushTestResultSchema = v.object({ status: v.number() })

/** What one push message carries to the service worker (`apps/web/public/sw.js`). */
export type PushNotice = {
  readonly title: string
  readonly body: string
  readonly tag?: string
  /** Opened relative to the app base when the notification is clicked. */
  readonly path: string
}

/**
 * One session's route relative to the app base, spelled as the web address grammar writes it:
 * `~<workspace token>/chat/t/<session id>`.
 */
export function pushSessionPath(
  workspace: Pick<WorkspaceAddress, 'id' | 'name'>,
  sessionId: SessionId,
): string {
  const token = encodeURIComponent(`${workspace.name}.${workspace.id}`).replaceAll('~', '%7E')
  return `~${token}/chat/t/${sessionId}`
}

export type PushService = v.InferOutput<typeof pushServiceSchema>
export type PushSubscriptionInput = v.InferOutput<typeof pushSubscriptionSchema>
export type PushDeviceRegistration = v.InferOutput<typeof pushDeviceRegistrationSchema>
export type PushDevice = v.InferOutput<typeof pushDeviceSchema>
export type PushDevices = v.InferOutput<typeof pushDevicesSchema>

/**
 * A device's id: the first 16 bytes of SHA-256 over its endpoint, in hex. The server keys
 * rows by it and the browser derives the same id to find itself in the list.
 */
export async function pushDeviceId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
