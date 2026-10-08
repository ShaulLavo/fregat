import type { CharId } from '@singapore-editor/collab'
import type { Checkpoint } from './protocol'

export type CharacterGap = {
  readonly left: CharId | 'start'
  readonly right: CharId | 'end'
  readonly bias: 'left' | 'right'
}
export type PresenceState = {
  readonly peerSessionId: string
  readonly presenceClock: number
  readonly documentId: string
  readonly epoch: string
  readonly tip: Checkpoint
  readonly displayName: string
  readonly colour: string
  readonly focusedViewId: string | null
  readonly selections: readonly { readonly anchor: CharacterGap; readonly head: CharacterGap }[]
}
export type PresenceMessage = { readonly clock: number; readonly state: PresenceState | null }
export type LocalPresence = Omit<PresenceState, 'peerSessionId' | 'presenceClock' | 'documentId'>
export type GapResolver = { resolveGap(gap: CharacterGap): number | undefined }
export type PresenceObserver = {
  receive(peer: string, payload: unknown): void
  leave(peer: string): void
  departed(): void
}
export type PresenceChannel = {
  readonly presenceTime: number
  sendPresence(payload: PresenceMessage): void
  subscribePresence(observer: PresenceObserver): () => void
  subscribePresenceClock(listener: (now: number) => void): () => void
}

const RENEW_MS = 15_000
const EXPIRE_MS = 30_000
const UPDATE_MS = 50
const TOMBSTONE_MS = 60_000
const MAX_PEERS = 256
const MAX_SELECTIONS = 32
const MAX_ID = 256

type Entry = {
  updated: number
  applied: number
  state: PresenceState | null
  pending: PresenceState | undefined
}

/** Uses the caller's clock only while renewal, queued state or expiry needs work. */
export class Presence {
  private readonly entries = new Map<string, Entry>()
  private readonly clockFloors = new Map<string, number>()
  private readonly workPeers = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private remoteStates: readonly PresenceState[] = []
  private disposed = false
  private departed = false
  private local: PresenceState | null = null
  private clock = 0
  private now = 0
  private sent = -Infinity
  private queued = false
  private advertised = false
  private pruneAt = Infinity
  private attachments = 0
  private unsubscribe: (() => void) | undefined
  private unsubscribeClock: (() => void) | undefined

  constructor(
    readonly peerSessionId: string,
    readonly documentId: string,
    private readonly channel?: PresenceChannel,
  ) {
    if (!identifier(peerSessionId) || !identifier(documentId))
      throw new TypeError('Presence needs bounded peer and document identifiers')
  }

  get states(): readonly PresenceState[] {
    return this.remoteStates
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) throw new TypeError('Presence has been disposed')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attach(): () => void {
    if (this.disposed) throw new TypeError('Presence has been disposed')
    if (++this.attachments === 1 && this.channel) {
      this.readTime()
      this.prune()
      this.unsubscribe = this.channel.subscribePresence({
        receive: (peer, payload) => this.receive(peer, payload),
        leave: (peer) => this.remove(peer),
        departed: () => {
          this.departed = true
          this.leave()
          this.clearRemote()
          this.updateClock()
        },
      })
      if (this.local && !this.departed) this.publish(this.local)
      this.updateClock()
    }
    let attached = true
    return () => {
      if (!attached || this.disposed) return
      attached = false
      if (this.attachments > 1) {
        this.attachments--
        return
      }
      this.leave()
      this.attachments = 0
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.clearRemote()
      this.updateClock()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.leave()
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.attachments = 0
    this.clearRemote()
    this.entries.clear()
    this.clockFloors.clear()
    this.listeners.clear()
    this.updateClock()
  }

  setLocalState(state: LocalPresence | null): void {
    if (this.disposed) throw new TypeError('Presence has been disposed')
    if (state === null && this.local === null) return
    this.readTime()
    const clock = this.nextClock()
    const payload = parsePresence(
      {
        clock,
        state: state && {
          ...state,
          peerSessionId: this.peerSessionId,
          documentId: this.documentId,
          presenceClock: clock,
        },
      },
      this.peerSessionId,
      this.documentId,
    )
    if (!payload) throw new TypeError('Invalid local presence state')
    this.clock = clock
    this.local = payload.state
    this.queued = false
    if (this.attachments > 0 && this.channel && !this.departed) {
      this.queued = this.local !== null
      if (this.local && this.now - this.sent >= UPDATE_MS) this.sendCurrent()
      if (!this.local && this.advertised) this.sendCurrent()
    }
    this.updateClock()
  }

  leave(): void {
    if (this.local) this.setLocalState(null)
  }

  receive(peer: string, input: unknown): boolean {
    if (this.disposed || this.departed || peer === this.peerSessionId) return false
    this.readTime()
    this.prune()
    const payload = parsePresence(input, peer, this.documentId)
    if (!payload) return false
    const floor = this.clockFloors.get(peer)
    if (payload.clock <= (floor ?? 0)) return false
    if (floor === undefined && this.clockFloors.size >= MAX_PEERS) return false
    const entry = this.entries.get(peer) ?? {
      updated: this.now,
      applied: -Infinity,
      state: null,
      pending: undefined,
    }
    this.clockFloors.set(peer, payload.clock)
    entry.updated = this.now
    this.entries.set(peer, entry)
    if (payload.state && this.now - entry.applied < UPDATE_MS) {
      entry.pending = payload.state
      this.workPeers.add(peer)
      this.updateClock()
      return true
    }
    const changed = this.apply(peer, entry, payload.state)
    this.refreshStates()
    if (changed) this.changed()
    this.updateClock()
    return true
  }

  tick(now: number): void {
    if (this.disposed || this.departed || !Number.isFinite(now) || now < this.now) return
    this.now = now
    if (this.attachments > 0 && this.local && this.channel) {
      if (this.queued && now - this.sent >= UPDATE_MS) this.sendCurrent()
      if (!this.queued && now - this.sent >= RENEW_MS) this.publish(this.local)
    }
    let changed = false
    let applied = false
    for (const peer of this.workPeers) {
      const entry = this.entries.get(peer)!
      if (now - entry.updated >= EXPIRE_MS) {
        if (this.apply(peer, entry, null)) changed = true
        applied = true
        continue
      }
      if (!entry.pending || now - entry.applied < UPDATE_MS) continue
      if (this.apply(peer, entry, entry.pending)) changed = true
      applied = true
    }
    if (applied) this.refreshStates()
    if (changed) this.changed()
    this.updateClock()
  }

  private remove(peer: string): void {
    if (peer === this.peerSessionId) {
      this.leave()
      return
    }
    const entry = this.entries.get(peer)
    if (!entry || (!entry.state && !entry.pending)) return
    this.readTime()
    const changed = this.apply(peer, entry, null)
    this.refreshStates()
    if (changed) this.changed()
    this.updateClock()
  }

  private apply(peer: string, entry: Entry, state: PresenceState | null): boolean {
    const changed = visibleState(entry.state) !== visibleState(state)
    entry.state = state
    entry.pending = undefined
    entry.applied = this.now
    if (state) {
      this.workPeers.add(peer)
      return changed
    }
    entry.updated = this.now
    this.pruneAt = Math.min(this.pruneAt, this.now + TOMBSTONE_MS)
    this.workPeers.delete(peer)
    return changed
  }

  private clearRemote(): void {
    this.readTime()
    const changed = this.remoteStates.length > 0
    for (const peer of this.workPeers) this.apply(peer, this.entries.get(peer)!, null)
    this.refreshStates()
    if (changed) this.changed()
  }

  private publish(state: PresenceState): void {
    this.clock = this.nextClock()
    this.local = { ...state, presenceClock: this.clock }
    this.queued = true
    if (this.now - this.sent >= UPDATE_MS) this.sendCurrent()
  }

  private sendCurrent(): void {
    this.sent = this.now
    this.queued = false
    this.advertised = this.local !== null
    this.channel?.sendPresence({ clock: this.clock, state: this.local })
  }

  private nextClock(): number {
    if (this.clock === Number.MAX_SAFE_INTEGER) throw new RangeError('Presence clock exhausted')
    return this.clock + 1
  }

  private readTime(): void {
    if (this.channel) this.now = Math.max(this.now, this.channel.presenceTime)
  }

  private updateClock(): void {
    const needed =
      !this.disposed &&
      !this.departed &&
      this.attachments > 0 &&
      (this.local !== null || this.workPeers.size > 0)
    if (needed && !this.unsubscribeClock && this.channel) {
      this.unsubscribeClock = this.channel.subscribePresenceClock((now) => this.tick(now))
      return
    }
    if (needed) return
    this.unsubscribeClock?.()
    this.unsubscribeClock = undefined
  }

  private prune(): void {
    if (this.now < this.pruneAt) return
    this.pruneAt = Infinity
    for (const [peer, entry] of this.entries) {
      if (entry.state || entry.pending) continue
      const expires = entry.updated + TOMBSTONE_MS
      if (expires <= this.now) {
        this.entries.delete(peer)
        continue
      }
      this.pruneAt = Math.min(this.pruneAt, expires)
    }
  }

  private refreshStates(): void {
    this.remoteStates = Array.from(this.workPeers, (peer) => this.entries.get(peer)!.state).filter(
      (state): state is PresenceState => state !== null,
    )
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Copies only validated fields, so retained remote data has a fixed memory bound. */
export function parsePresence(
  input: unknown,
  peer: string,
  document: string,
): PresenceMessage | undefined {
  if (!identifier(peer) || !record(input) || !integer(input.clock)) return
  if (input.state === null) return { clock: input.clock, state: null }
  const state = input.state
  if (
    !record(state) ||
    state.peerSessionId !== peer ||
    state.documentId !== document ||
    state.presenceClock !== input.clock ||
    !identifier(state.epoch)
  )
    return
  if (!record(state.tip) || !integer(state.tip.depth) || !identifier(state.tip.hash)) return
  if (
    typeof state.displayName !== 'string' ||
    state.displayName.length < 1 ||
    state.displayName.length > 128 ||
    /[\p{Cc}\p{Cf}]/u.test(state.displayName)
  )
    return
  if (typeof state.colour !== 'string' || !/^#[\da-f]{6}$/i.test(state.colour)) return
  if (state.focusedViewId !== null && !identifier(state.focusedViewId)) return
  if (!Array.isArray(state.selections) || state.selections.length > MAX_SELECTIONS) return
  const selections: PresenceState['selections'][number][] = []
  for (const selection of state.selections) {
    if (!record(selection)) return
    const anchor = parseGap(selection.anchor)
    const head = parseGap(selection.head)
    if (!anchor || !head) return
    selections.push({ anchor, head })
  }
  return {
    clock: input.clock,
    state: {
      peerSessionId: peer,
      documentId: document,
      presenceClock: input.clock,
      epoch: state.epoch,
      tip: { depth: state.tip.depth, hash: state.tip.hash },
      displayName: state.displayName,
      colour: state.colour,
      focusedViewId: state.focusedViewId,
      selections,
    },
  }
}

function parseGap(input: unknown): CharacterGap | undefined {
  if (!record(input) || (input.bias !== 'left' && input.bias !== 'right')) return
  const left = input.left === 'start' ? 'start' : parseChar(input.left)
  const right = input.right === 'end' ? 'end' : parseChar(input.right)
  if (!left || !right) return
  return { left, right, bias: input.bias }
}
function parseChar(input: unknown): CharId | undefined {
  if (!record(input) || !identifier(input.bunch) || !integer(input.counter)) return
  return { bunch: input.bunch, counter: input.counter }
}
function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
function integer(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) >= 0
}
function identifier(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.length > 0 &&
    input.length <= MAX_ID &&
    !/[\p{Cc}\p{Cf}]/u.test(input)
  )
}

function visibleState(state: PresenceState | null): string {
  return JSON.stringify(state && { ...state, presenceClock: 0 })
}
