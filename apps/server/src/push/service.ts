import {
  pushDeviceId,
  type PushDevice,
  type PushDevices,
  type PushNotice,
} from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import { recordRequestContext } from '../observability'
import type { SettingsStore } from '../settings/store'
import { deliverPush, type PushDelivery, type PushFetcher } from './delivery'
import { PushDeviceStore, type PushDeviceRow } from './device-store'
import { pushErrors } from './structured-errors'
import { parseRegistration } from './subscription'
import { loadVapidKeys } from './vapid'

export type PushServiceOptions = {
  readonly database: PlatformDatabase
  readonly settings: SettingsStore
  readonly fetcher?: PushFetcher
}

const TEST_NOTICE: PushNotice = {
  title: 'Test notification',
  body: 'Push notifications from this server reach this device.',
  tag: 'push-test',
  path: '',
}

/** Devices subscribed to Web Push, and the sends to them. */
export class PushService {
  private readonly devices: PushDeviceStore
  private readonly settings: SettingsStore
  private readonly fetcher: PushFetcher

  constructor(options: PushServiceOptions) {
    this.devices = new PushDeviceStore(options.database)
    this.settings = options.settings
    // Late-bound, so a test's fetch interceptor installed after construction still applies.
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  }

  async list(): Promise<PushDevices> {
    const keys = await loadVapidKeys(this.settings)
    const devices = this.devices.list().map(publicDevice)
    recordRequestContext({ push: { deviceCount: devices.length } })

    return { publicKey: keys.publicKey, devices }
  }

  async register(input: unknown, origin: string | null): Promise<PushDevice> {
    const { label, subscription } = parseRegistration(input)
    const now = new Date().toISOString()
    const row = this.devices.upsert({
      ...subscription,
      id: await pushDeviceId(subscription.endpoint),
      label,
      origin: pageOrigin(origin),
      createdAt: now,
      updatedAt: now,
    })
    recordRequestContext({ push: { service: row.service } })

    return publicDevice(row)
  }

  remove(id: string): { removed: boolean } {
    const removed = this.devices.remove(id)
    recordRequestContext({ push: { removed } })

    return { removed }
  }

  async sendTest(id: string): Promise<{ status: number }> {
    const device = this.devices.get(id)
    if (!device)
      throw pushErrors.DEVICE_NOT_FOUND({ internal: { deviceCount: this.devices.list().length } })

    const keys = await loadVapidKeys(this.settings)
    const delivery = await deliverPush(this.fetcher, device, keys, TEST_NOTICE, {
      topic: 'push-test',
      ttlSeconds: 300,
      urgency: 'high',
    })
    recordRequestContext({ push: { deviceCount: 1, kind: 'test', ...delivery } })

    return { status: settledStatus(delivery) }
  }
}

/** A 404 or 410 reaches the caller as an expired device, and the row stays. */
function settledStatus(delivery: PushDelivery): number {
  const { failure, service, status } = delivery
  if (status === null) throw pushErrors.PUSH_SERVICE_UNREACHABLE({ internal: { failure, service } })
  if (delivery.outcome === 'expired')
    throw pushErrors.SUBSCRIPTION_EXPIRED({ internal: { service, status } })
  if (delivery.outcome === 'rejected')
    throw pushErrors.PUSH_SERVICE_REJECTED({ answer: status, internal: { service } })

  return status
}

function publicDevice(row: PushDeviceRow): PushDevice {
  return { id: row.id, label: row.label, service: row.service, createdAt: row.createdAt }
}

function pageOrigin(origin: string | null) {
  if (!origin) return null

  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}
