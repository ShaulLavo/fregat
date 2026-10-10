import { createHash, timingSafeEqual } from 'node:crypto'
import {
  pairingLink,
  type PairedDevice,
  type PairingClaim,
  type PairingLink,
  type PairingTrust,
} from '@workspace/contracts'

import { recordRequestContext, runDetached } from '../observability'
import type { DeviceStore } from './device-store'
import { PairingCodes } from './pairing-codes'
import { pairingErrors } from './structured-errors'
import type { TailnetOwners } from './tailnet-owner'
import { deviceCredential, isDirectLocal, forwardedPeer, type HeaderReader } from './trust'

/** A device unseen this long is dropped, and pairs again. */
const DEVICE_IDLE_MS = 30 * 24 * 60 * 60_000
/** How stale `lastSeenAt` may get before a request writes it: a write per request is waste. */
const LAST_SEEN_STEP_MS = 10 * 60_000
/** The browser keeps the cookie as long as it allows; the server's idle limit decides. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
/** How often idle devices are dropped, closing what they still hold open. */
const SWEEP_MS = 60 * 60_000
/** How often sockets admitted by Tailscale identity are checked again; matches its cache. */
const TAILNET_RECHECK_MS = 60_000
/** Live sockets are kept by device id, or by this prefix and the Tailscale address. */
const TAILNET_KEY = 'tailnet:'
const RECHECK_CONTEXT = { area: 'pairing', operation: 'recheck_tailnet' }

type Admission = { readonly trust: PairingTrust; readonly deviceId: string | null }

/**
 * Who may reach this machine. Requests from the machine itself pass, and so do the owner's own
 * Tailscale devices; any other device needs the cookie a one-time pairing link gave it. Pairing
 * grants full access: there is one trust level, so a paired device may make links too.
 */
export class DevicePairing {
  private readonly store: DeviceStore
  private readonly codes = new PairingCodes()
  private readonly required: () => boolean
  private readonly trustedProxyHosts: () => readonly string[]
  private readonly tailnet: TailnetOwners | null
  private readonly now: () => number
  private readonly appUrl: string | null
  /** The close of every live socket, by the device or Tailscale address it was admitted for. */
  private readonly live = new Map<string, Map<() => void, HeaderReader>>()
  readonly cookieName: string

  constructor(options: {
    readonly store: DeviceStore
    readonly required: () => boolean
    readonly cookieName: string
    readonly trustedProxyHosts?: () => readonly string[]
    readonly tailnet?: TailnetOwners
    readonly now?: () => number
    /** The app's public base URL that devices open, for links; null when only loopback serves it. */
    readonly appUrl?: string | null
  }) {
    this.store = options.store
    this.required = options.required
    this.cookieName = options.cookieName
    this.trustedProxyHosts = options.trustedProxyHosts ?? (() => [])
    this.tailnet = options.tailnet ?? null
    this.now = options.now ?? Date.now
    this.appUrl = options.appUrl ?? null
  }

  /** A settings store that cannot answer leaves pairing on: it fails closed. */
  isRequired() {
    try {
      return this.required()
    } catch {
      return true
    }
  }

  /**
   * Asks Tailscale who the forwarded client is, so `admit` can answer synchronously. Run it at the
   * start of each request; it asks at most once a minute per address.
   */
  async identify(header: HeaderReader) {
    if (isDirectLocal(header)) return
    const peer = this.proxyPeer(header)
    if (peer === null || !this.tailnet) return
    await this.tailnet.resolve(peer)
  }

  admit(header: HeaderReader): Admission {
    if (isDirectLocal(header)) return { trust: 'host', deviceId: null }
    const peer = this.proxyPeer(header)
    const device = this.device(header)
    if (device) {
      this.markSeen(device.id, device.lastSeenAt)
      return { trust: 'device', deviceId: device.id }
    }
    const verdict = peer === null || !this.tailnet ? 'not-tailnet' : this.tailnet.verdict(peer)
    recordRequestContext({ tailnetTrust: verdict })
    if (verdict === 'same-user') return { trust: 'tailnet', deviceId: null }
    return { trust: 'unpaired', deviceId: null }
  }

  /**
   * Ties a live socket to what admitted it: removing the device, its going idle, or its Tailscale
   * identity no longer passing closes the socket, so nothing already open keeps the access.
   * Returns the release for its close.
   */
  hold(header: HeaderReader, close: () => void) {
    const key = this.holdKey(header)
    if (key === null) return noop
    const closes = this.live.get(key) ?? new Map<() => void, HeaderReader>()
    closes.set(close, header)
    this.live.set(key, closes)
    return () => {
      closes.delete(close)
      if (closes.size === 0) this.live.delete(key)
    }
  }

  /** Sweeps every hour, and checks Tailscale-admitted sockets every minute, until stopped. */
  startSweeping() {
    const sweep = setInterval(() => this.sweep(), SWEEP_MS)
    const recheck = setInterval(
      () => runDetached(() => this.recheckTailnet(), RECHECK_CONTEXT),
      TAILNET_RECHECK_MS,
    )
    sweep.unref?.()
    recheck.unref?.()
    return () => {
      clearInterval(sweep)
      clearInterval(recheck)
    }
  }

  /**
   * Asks Tailscale again about every address holding sockets open, and closes those it no longer
   * vouches for. Run on a timer and whenever settings change.
   */
  async recheckTailnet() {
    const addresses = Array.from(this.live.keys()).flatMap((key) =>
      key.startsWith(TAILNET_KEY) ? [key.slice(TAILNET_KEY.length)] : [],
    )
    for (const address of addresses) {
      await this.tailnet?.resolve(address)
      const verdict = this.tailnet?.verdict(address) ?? 'off'
      if (!this.isRequired()) continue
      if (verdict !== 'same-user') {
        this.closeSockets(TAILNET_KEY + address)
        continue
      }
      const key = TAILNET_KEY + address
      const closes = this.live.get(key)
      for (const [close, header] of closes ?? []) {
        if (this.proxyPeer(header) === address) continue
        closes?.delete(close)
        close()
      }
      if (closes?.size === 0) this.live.delete(key)
    }
  }

  /** Drops the devices unseen for 30 days, and closes what they still had open. */
  sweep() {
    for (const device of this.store.list()) if (this.idle(device.lastSeenAt)) this.forget(device.id)
  }

  /** True when the request may go on: from this machine, from a paired device, or pairing is off. */
  allows(header: HeaderReader) {
    // Trust first: this machine's own requests never read the settings, which may be mid-recovery.
    return this.admit(header).trust !== 'unpaired' || !this.isRequired()
  }

  /** Any device let in may let the next one in: pairing has one trust level, so this grants nothing. */
  issueLink(header: HeaderReader): PairingLink {
    const { trust } = this.admit(header)
    if (trust === 'unpaired') throw pairingErrors.PAIRED_ONLY({ internal: { trust } })
    const issued = this.codes.issue(this.now())
    const link = { ...issued, url: this.appUrl ? pairingLink(this.appUrl, issued.code) : null }
    recordRequestContext({
      pairing: { outcome: 'link-issued', issuedBy: trust, expiresAt: link.expiresAt },
    })
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
    const replaced =
      claim.relaySourceId === undefined
        ? []
        : this.store
            .list()
            .filter((device) => device.relaySourceId === claim.relaySourceId)
            .map((device) => device.id)
    this.store.add({
      id,
      relaySourceId: claim.relaySourceId,
      label: claim.label,
      secretHash: hash(secret),
      pairedAt: at,
      lastSeenAt: at,
    })
    for (const previous of replaced) this.closeSockets(previous)
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

  private proxyPeer(header: HeaderReader) {
    try {
      return forwardedPeer(header, this.trustedProxyHosts())
    } catch {
      return null
    }
  }

  private holdKey(header: HeaderReader) {
    const { trust, deviceId } = this.admit(header)
    if (deviceId !== null) return deviceId
    const peer = this.proxyPeer(header)
    return trust === 'tailnet' && peer !== null ? TAILNET_KEY + peer : null
  }

  private forget(id: string) {
    this.store.remove(id)
    this.closeSockets(id)
  }

  private closeSockets(id: string) {
    const closes = this.live.get(id)
    this.live.delete(id)
    for (const close of closes?.keys() ?? []) close()
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
