export type CharId = { readonly bunch: string; readonly counter: number }
export type EditId = { readonly actor: string; readonly seq: number }
export type LeftOrigin = CharId | 'start'
export type RightOrigin = CharId | 'end'
export type IdSpan = { readonly start: CharId; readonly count: number }
export type CharacterIdentity = {
  readonly id: CharId
  readonly deleted: boolean
  readonly offset: number
}
export type Insert = {
  readonly start: CharId
  readonly originLeft: LeftOrigin
  readonly originRight: RightOrigin
  readonly text: string
}
export type Effect = { readonly op: EditId; readonly active: boolean }
export type SetEffects = {
  readonly kind: 'setEffects'
  readonly command: EditId
  readonly effects: readonly Effect[]
}
export type Change =
  | SetEffects
  | (Insert & { readonly kind: 'insert' })
  | { readonly kind: 'delete'; readonly spans: readonly IdSpan[] }
  | { readonly kind: 'replace'; readonly spans: readonly IdSpan[]; readonly insert: Insert }
export type Envelope = {
  readonly document: string
  readonly epoch: string
  readonly id: EditId
  readonly lamport: number
  readonly deps: readonly EditId[]
  readonly change: Change
}
export type OffsetEdit = {
  readonly offset: number
  readonly deleteCount: number
  readonly text: string
}
/** Effective edits use offsets in the previous projection, matching the editor's TextEdit. */
export type EffectiveEdit = { readonly from: number; readonly to: number; readonly text: string }
export type AuthorContext = Omit<Envelope, 'change'> & {
  readonly allocate: (left: LeftOrigin, count: number) => CharId
}

/** Snapshots are immutable and reusable; the engine owns their representation. */
export interface Engine<Snapshot = unknown> {
  text(): string
  changesBetween(snapshot: Snapshot): readonly EffectiveEdit[]
  /** Diagnostic inventory sorted by bunch/counter; hidden IDs retain their visible gap. */
  characters(): readonly CharacterIdentity[]
  /** Applies text edits and atomic effect states, retaining provenance in snapshots. */
  apply(envelope: Envelope): void
  /** Author against the current projection, reserve IDs once, and leave text unchanged. */
  author(edit: OffsetEdit, context: AuthorContext): Envelope
  snapshot(): Snapshot
  restore(snapshot: Snapshot): void
}

export function editKey(id: EditId): string {
  return JSON.stringify([id.actor, id.seq])
}

export function charKey(id: CharId): string {
  return JSON.stringify([id.bunch, id.counter])
}

export function sameChar(a: LeftOrigin | RightOrigin, b: LeftOrigin | RightOrigin): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  return a.bunch === b.bunch && a.counter === b.counter
}

export function insertionOf(change: Change): Insert | null {
  if (change.kind === 'insert') return change
  if (change.kind === 'replace') return change.insert
  return null
}
