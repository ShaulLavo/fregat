export type EditId = { readonly actor: string; readonly seq: number }

// Structurally accepts the document package's envelope without interpreting its change.
export interface EditEnvelope<Change = unknown> {
  readonly document: string
  readonly epoch: string
  readonly id: EditId
  readonly lamport: number
  readonly deps: readonly EditId[]
  readonly change: Change
}

export type Outcome =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'rejected'; readonly reason: string }
export interface Checkpoint {
  readonly depth: number
  readonly hash: string
}
export interface Confirmation<E extends EditEnvelope = EditEnvelope> {
  readonly depth: number
  readonly predecessor: string
  readonly hash: string
  readonly id: EditId
  readonly edit: E
  readonly outcome: Outcome
}

/** All history methods include rejected outcomes. Verification checks the complete hash chain. */
export interface DocumentEngine<E extends EditEnvelope> {
  checkpoint(): Checkpoint
  outcome(id: EditId): Outcome | undefined
  // A session rejection records unresolved dependencies without applying the opaque change.
  sequence(edit: E, rejection?: string): Confirmation<E>
  apply(record: Confirmation<E>): boolean
  exportHistory(from: Checkpoint): readonly Confirmation<E>[] | undefined
  verify(history: readonly Confirmation<E>[], tip: Checkpoint): boolean
  install(history: readonly Confirmation<E>[]): void
  uniquePending(history: readonly Confirmation<E>[]): readonly E[]
}

export interface Authority {
  readonly term: number
  readonly host: string
  readonly epoch: string
}
export interface Branch {
  readonly tip: Checkpoint
  readonly authority: Authority
}
export interface Round {
  readonly coordinator: string
  readonly serial: number
  readonly roster: readonly string[]
}
export interface Offer {
  readonly round: Round | null
  readonly branch: Branch
  readonly term: number
}
export interface Commit<E extends EditEnvelope> {
  readonly round: Round
  readonly authority: Authority
  readonly base: Branch
  readonly offers: readonly { readonly peer: string; readonly branch: Branch }[]
  readonly replay: readonly E[]
}

export interface Payloads<E extends EditEnvelope> {
  HELLO: {
    readonly branch: Branch
    readonly term: number
    readonly members: readonly string[]
    readonly handoff?: Payloads<E>['HANDOFF']
  }
  HOST_PULSE: {
    readonly branch: Branch
    readonly members: readonly string[]
    readonly handoff?: Payloads<E>['HANDOFF']
  }
  ELECTION_OFFER: Offer
  HOST_CLAIM: Commit<E>
  SUBMIT: { readonly authority: Authority; readonly edit: E }
  CONFIRM: { readonly authority: Authority; readonly record: Confirmation<E> }
  HAVE: {
    readonly tip: Checkpoint
    readonly epoch: string
  } & (
    | { readonly handoffStage?: never; readonly pending?: never }
    | { readonly handoffStage: 'prepare' | 'commit'; readonly pending: readonly EditId[] }
  )
  HISTORY_REQUEST: { readonly tip: Checkpoint; readonly from: Checkpoint }
  HISTORY_CHUNK: {
    readonly tip: Checkpoint
    readonly from: Checkpoint
    readonly index: number
    readonly count: number
    readonly records: readonly Confirmation<E>[]
  }
  RECONCILE_OFFER: Offer
  RECONCILE_COMMIT: Commit<E>
  PRESENCE: { readonly clock: number; readonly state: unknown }
  LEAVE: { readonly successor: string | null }
  HANDOFF: {
    readonly stage: 'prepare' | 'commit'
    readonly successor: string
    readonly branch: Branch
    readonly authority: Authority
    readonly pending: readonly E[]
  }
}

export type Message<E extends EditEnvelope = EditEnvelope> = {
  [K in keyof Payloads<E>]: {
    readonly version: 1
    readonly room: string
    readonly document: string
    readonly sender: string
    readonly messageId: number
    readonly epoch: string
    readonly type: K
    readonly payload: Payloads<E>[K]
  }
}[keyof Payloads<E>]

export function editKey(id: EditId): string {
  return JSON.stringify([id.actor, id.seq])
}
export function tipKey(tip: Checkpoint): string {
  return JSON.stringify([tip.depth, tip.hash])
}
export function sameTip(a: Checkpoint, b: Checkpoint): boolean {
  return a.depth === b.depth && a.hash === b.hash
}
export function sameAuthority(a: Authority, b: Authority): boolean {
  return a.term === b.term && a.host === b.host && a.epoch === b.epoch
}
export function roundKey(round: Round): string {
  return JSON.stringify([round.coordinator, round.serial, round.roster])
}
export function compareBranches(a: Branch, b: Branch): number {
  return (
    b.tip.depth - a.tip.depth ||
    compareIds(a.authority.host, b.authority.host) ||
    compareIds(a.tip.hash, b.tip.hash)
  )
}
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : Number(a > b)
}

export function inOneLineage<E extends EditEnvelope>(
  histories: readonly (readonly Confirmation<E>[])[],
): boolean {
  const longest = histories.toSorted((a, b) => b.length - a.length)[0] ?? []
  return histories.every((history) =>
    history.every((record, i) => record.hash === longest[i]?.hash),
  )
}
