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
  tick(now: number): void
  leave(peer: string): void
}
export type PresenceChannel = {
  sendPresence(payload: PresenceMessage): void
  subscribePresence(observer: PresenceObserver): () => void
}

const RENEW_MS = 15_000
const EXPIRE_MS = 30_000
const MAX_PEERS = 256
const MAX_SELECTIONS = 32
const MAX_ID = 256

type Entry = { clock: number; updated: number; state: PresenceState | null }

/** Session-driven awareness has no scheduler of its own, including while detached. */
export class Presence {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private remoteStates: readonly PresenceState[] = []
  private disposed = false
  private local: PresenceState | null = null
  private clock = 0
  private now = 0
  private renewed = 0
  private attachments = 0
  private unsubscribe: (() => void) | undefined

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
      this.unsubscribe = this.channel.subscribePresence({
        receive: (peer, payload) => this.receive(peer, payload),
        tick: (now) => this.tick(now),
        leave: (peer) => this.remove(peer),
      })
      if (this.local) this.publish(this.local)
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
      for (const entry of this.entries.values()) entry.state = null
      this.changed()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.leave()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.attachments = 0
    this.entries.clear()
    this.changed()
    this.listeners.clear()
    this.disposed = true
  }

  setLocalState(state: LocalPresence | null): void {
    if (this.disposed) throw new TypeError('Presence has been disposed')
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
    this.renewed = this.now
    if (this.attachments > 0) this.channel?.sendPresence(payload)
  }

  leave(): void {
    if (!this.local) return
    this.setLocalState(null)
  }

  receive(peer: string, input: unknown): boolean {
    if (this.disposed || peer === this.peerSessionId) return false
    const payload = parsePresence(input, peer, this.documentId)
    if (!payload) return false
    const previous = this.entries.get(peer)
    if (!previous && (payload.clock === 0 || this.entries.size >= MAX_PEERS)) return false
    if (
      previous &&
      (payload.clock < previous.clock ||
        (payload.clock === previous.clock && (payload.state !== null || previous.state === null)))
    )
      return false
    this.entries.set(peer, { clock: payload.clock, updated: this.now, state: payload.state })
    this.refreshStates()
    if (visibleState(previous?.state ?? null) !== visibleState(payload.state)) this.changed()
    return true
  }

  tick(now: number): void {
    if (this.disposed || !Number.isFinite(now) || now < this.now) return
    this.now = now
    if (this.attachments > 0 && this.local && now - this.renewed >= RENEW_MS)
      this.publish(this.local)
    let removed = false
    for (const entry of this.entries.values()) {
      if (!entry.state || now - entry.updated < EXPIRE_MS) continue
      entry.state = null
      removed = true
    }
    if (removed) this.changed()
  }

  private remove(peer: string): void {
    if (peer === this.peerSessionId) {
      this.leave()
      return
    }
    const entry = this.entries.get(peer)
    if (!entry?.state) return
    entry.state = null
    this.changed()
  }

  private publish(state: PresenceState): void {
    this.clock = this.nextClock()
    this.local = { ...state, presenceClock: this.clock }
    this.renewed = this.now
    this.channel?.sendPresence({ clock: this.clock, state: this.local })
  }

  private nextClock(): number {
    if (this.clock === Number.MAX_SAFE_INTEGER) throw new RangeError('Presence clock exhausted')
    return this.clock + 1
  }

  private refreshStates(): void {
    this.remoteStates = Array.from(this.entries.values(), (entry) => entry.state).filter(
      (state): state is PresenceState => state !== null,
    )
  }

  private changed(): void {
    this.refreshStates()
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
