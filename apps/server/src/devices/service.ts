import { createHash, timingSafeEqual } from 'node:crypto'
import type { PairedDevice, PairingClaim, PairingTrust } from '@workspace/contracts'

import { recordRequestContext } from '../observability'
import type { DeviceStore } from './device-store'
import { PairingCodes } from './pairing-codes'
import { pairingErrors } from './structured-errors'
import {
  deviceCredential,
  forwardedClient,
  isThisMachine,
  ownAddresses,
  type HeaderReader,
} from './trust'

/** A device unseen this long is dropped, and pairs again. */
const DEVICE_IDLE_MS = 30 * 24 * 60 * 60_000
/** How stale `lastSeenAt` may get before a request writes it: a write per request is waste. */
const LAST_SEEN_STEP_MS = 10 * 60_000
/** The browser keeps the cookie as long as it allows; the server's idle limit decides. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
/** How often idle devices are dropped, closing what they still hold open. */
const SWEEP_MS = 60 * 60_000

type Admission = { readonly trust: PairingTrust; readonly deviceId: string | null }

/**
 * Who may reach this machine. Requests from the machine itself pass; any other device needs the
 * cookie a one-time pairing link gave it. Pairing grants full access: there is one trust level.
 */
export class DevicePairing {
  private readonly store: DeviceStore
  private readonly codes = new PairingCodes()
  private readonly required: () => boolean
  private readonly own: () => ReadonlySet<string>
  private readonly now: () => number
  /** The close of every live socket, by the device it was admitted for. */
  private readonly live = new Map<string, Set<() => void>>()
  readonly cookieName: string

  constructor(options: {
    readonly store: DeviceStore
    readonly required: () => boolean
    readonly cookieName: string
    readonly ownAddresses?: () => ReadonlySet<string>
    readonly now?: () => number
  }) {
    this.store = options.store
    this.required = options.required
    this.cookieName = options.cookieName
    this.own = options.ownAddresses ?? ownAddresses
    this.now = options.now ?? Date.now
  }

  isRequired() {
    return this.required()
  }

  admit(header: HeaderReader): Admission {
    const client = forwardedClient(header)
    if (client === null || isThisMachine(client, this.own()))
      return { trust: 'host', deviceId: null }
    const device = this.device(header)
    if (!device) return { trust: 'unpaired', deviceId: null }
    this.markSeen(device.id, device.lastSeenAt)
    return { trust: 'device', deviceId: device.id }
  }

  /**
   * Ties a live socket to the device it was admitted for: removing the device, or its going idle,
   * closes the socket, so nothing already open keeps the access. Returns the release for its close.
   */
  hold(header: HeaderReader, close: () => void) {
    const { deviceId } = this.admit(header)
    if (deviceId === null) return noop
    const closes = this.live.get(deviceId) ?? new Set()
    closes.add(close)
    this.live.set(deviceId, closes)
    return () => {
      closes.delete(close)
      if (closes.size === 0) this.live.delete(deviceId)
    }
  }

  /** Sweeps every hour until the returned stop is called. */
  startSweeping() {
    const timer = setInterval(() => this.sweep(), SWEEP_MS)
    timer.unref?.()
    return () => clearInterval(timer)
  }

  /** Drops the devices unseen for 30 days, and closes what they still had open. */
  sweep() {
    for (const device of this.store.list()) if (this.idle(device.lastSeenAt)) this.forget(device.id)
  }

  /** True when the request may go on: from this machine, from a paired device, or pairing is off. */
  allows(header: HeaderReader) {
    return !this.required() || this.admit(header).trust !== 'unpaired'
  }

  issueLink(header: HeaderReader) {
    const { trust } = this.admit(header)
    if (trust !== 'host') throw pairingErrors.HOST_ONLY({ internal: { trust } })
    const link = this.codes.issue(this.now())
    recordRequestContext({ pairing: { outcome: 'link-issued', expiresAt: link.expiresAt } })
    return link
  }

  /** Pairs the device holding a valid code and returns the cookie that proves it from now on. */
  claim(claim: PairingClaim, secure: boolean) {
    const outcome = this.codes.claim(claim.code, this.now())
    recordRequestContext({ pairing: { outcome: `claim-${outcome}` } })
    if (outcome !== 'accepted')
      throw outcome === 'rate-limited'
        ? pairingErrors.RATE_LIMITED({ internal: { outcome } })
        : pairingErrors.CODE_INVALID({ internal: { outcome } })
    const id = crypto.randomUUID()
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const at = new Date(this.now()).toISOString()
    this.store.add({
      id,
      label: claim.label,
      secretHash: hash(secret),
      pairedAt: at,
      lastSeenAt: at,
    })
    return { deviceId: id, cookie: this.cookie(`${id}.${secret}`, secure) }
  }

  list(currentId: string | null): PairedDevice[] {
    return this.store
      .list()
      .filter((device) => !this.idle(device.lastSeenAt))
      .map((device) => ({
        id: device.id,
        label: device.label,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        current: device.id === currentId,
      }))
  }

  revoke(id: string, currentId: string | null) {
    if (id === currentId) throw pairingErrors.CURRENT_DEVICE({ internal: { deviceId: id } })
    if (!this.store.remove(id))
      throw pairingErrors.DEVICE_NOT_FOUND({
        internal: { deviceId: id, pairedCount: this.store.list().length },
      })
    this.closeSockets(id)
  }

  private forget(id: string) {
    this.store.remove(id)
    this.closeSockets(id)
  }

  private closeSockets(id: string) {
    const closes = this.live.get(id)
    this.live.delete(id)
    for (const close of closes ?? []) close()
  }

  private device(header: HeaderReader) {
    const credential = deviceCredential(header, this.cookieName)
    if (!credential) return null
    const device = this.store.get(credential.id)
    if (!device || this.idle(device.lastSeenAt)) return null
    return sameHash(device.secretHash, hash(credential.secret)) ? device : null
  }

  private markSeen(id: string, lastSeenAt: string) {
    const now = this.now()
    if (now - Date.parse(lastSeenAt) < LAST_SEEN_STEP_MS) return
    this.store.touch(id, new Date(now).toISOString())
  }

  private idle(lastSeenAt: string) {
    return this.now() - Date.parse(lastSeenAt) > DEVICE_IDLE_MS
  }

  private cookie(value: string, secure: boolean) {
    const attributes = [
      `${this.cookieName}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    ]
    if (secure) attributes.push('Secure')
    return attributes.join('; ')
  }
}

function hash(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function noop() {}
