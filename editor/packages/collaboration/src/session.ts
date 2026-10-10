import type { PresenceMessage, PresenceObserver } from './presence'
import {
  compareBranches,
  compareIds,
  editKey,
  inOneLineage,
  roundKey,
  sameAuthority,
  sameTip,
  tipKey,
  type Authority,
  type Branch,
  type Checkpoint,
  type Commit,
  type Confirmation,
  type DocumentEngine,
  type EditEnvelope,
  type Message,
  type Offer,
  type Payloads,
  type Round,
} from './protocol'
import { ReplayWindow } from './replay-window'
import { MESSAGE_LIMIT } from './framing'

export interface SessionOptions<E extends EditEnvelope> {
  readonly peer: string
  readonly room: string
  readonly document: string
  readonly genesis: Checkpoint
  readonly engine: DocumentEngine<E>
  readonly send: (peer: string, message: Message<E>) => void
  readonly pulseInterval: number
  readonly suspicionTimeout: number
  readonly dependencyTimeout: number
  readonly historyChunkRecords: number
  readonly replayWindowSize?: number
  readonly onPresence?: (peer: string, payload: Payloads<E>['PRESENCE']) => void
}

type HistoryTransfer<E extends EditEnvelope> = {
  readonly tip: Checkpoint
  readonly scope: string | undefined
  from: Checkpoint
  readonly chunks: Map<number, readonly Confirmation<E>[]>
  next: number
  count?: number
  nextRequest: number
  readonly requested: Map<number, number>
}

type Phase<E extends EditEnvelope> =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'collecting'; readonly round: Round; readonly offers: Map<string, Offer> }
  | {
      readonly kind: 'activating'
      readonly commit: Commit<E>
      readonly acknowledgements: Set<string>
    }
  | { readonly kind: 'stable' }
  | {
      readonly kind: 'handoff'
      readonly successor: string
      readonly branch: Branch
      readonly next: Authority
      readonly committed: boolean
      readonly acknowledgements: Set<string>
      readonly transferred: Set<string>
    }
  | { readonly kind: 'left' }

/** A caller-driven clock keeps networking and liveness outside synchronous document edits. */
export class Session<E extends EditEnvelope> {
  readonly pending = new Map<string, E>()
  readonly archives: { readonly branch: Branch; readonly history: readonly Confirmation<E>[] }[] =
    []
  readonly members = new Set<string>()
  private readonly presenceObservers = new Set<PresenceObserver>()
  private readonly presenceClocks = new Set<(now: number) => void>()
  private readonly unreachable = new Map<string, number>()
  private phase: Phase<E> = { kind: 'waiting' }
  private authority: Authority
  private maxTerm = 0
  private serial = 0
  private messageId = 0
  private lastTick = -Infinity
  private lastHostPulse = -Infinity
  private now = 0
  private readonly replayWindowSize: number
  private readonly seen = new Map<string, ReplayWindow>()
  private readonly histories = new Map<string, readonly Confirmation<E>[]>()
  private readonly latestRounds = new Map<string, number>()
  private readonly transfers = new Map<string, HistoryTransfer<E>>()
  private commitWaiting: Commit<E> | undefined
  private lastCommit: Commit<E> | undefined
  private incomingHandoff: Payloads<E>['HANDOFF'] | undefined
  private departure: string | undefined
  private readonly departed = new Set<string>()
  private lastHandoff: Payloads<E>['HANDOFF'] | undefined
  private readonly blockedSince = new Map<string, number>()
  private readonly observed = new Map<
    string,
    { readonly messageId: number; readonly branch: Branch; readonly members: readonly string[] }
  >()

  constructor(private readonly options: SessionOptions<E>) {
    if (
      !Number.isFinite(options.pulseInterval) ||
      options.pulseInterval <= 0 ||
      !Number.isFinite(options.suspicionTimeout) ||
      options.suspicionTimeout <= options.pulseInterval
    )
      throw new RangeError(
        'Liveness needs a positive pulse interval and a longer suspicion timeout',
      )
    if (!Number.isFinite(options.dependencyTimeout) || options.dependencyTimeout <= 0)
      throw new RangeError('Dependency timeout must be positive and finite')
    if (!Number.isSafeInteger(options.historyChunkRecords) || options.historyChunkRecords < 1)
      throw new RangeError('History chunk size must be a positive record count')
    this.replayWindowSize = options.replayWindowSize ?? 8192
    if (!Number.isSafeInteger(this.replayWindowSize) || this.replayWindowSize < 1)
      throw new RangeError('Replay window size must be a positive safe integer')
    this.authority = { host: options.peer, term: 0, epoch: options.genesis.hash }
    this.members.add(options.peer)
    this.rememberLocal()
  }

  get peer(): string {
    return this.options.peer
  }
  get status(): Phase<E>['kind'] {
    return this.phase.kind
  }
  get host(): string | undefined {
    return this.phase.kind === 'stable' && this.compatibleMembership()
      ? this.authority.host
      : undefined
  }
  get isHost(): boolean {
    return this.host === this.peer
  }
  get branch(): Branch {
    return { tip: this.options.engine.checkpoint(), authority: this.authority }
  }

  get presenceTime(): number {
    return this.now
  }

  sendPresence(payload: PresenceMessage): void {
    if (this.phase.kind !== 'left') this.broadcast('PRESENCE', payload)
  }

  subscribePresence(observer: PresenceObserver): () => void {
    this.presenceObservers.add(observer)
    if (this.phase.kind === 'left') observer.departed()
    return () => this.presenceObservers.delete(observer)
  }

  subscribePresenceClock(listener: (now: number) => void): () => void {
    this.presenceClocks.add(listener)
    return () => this.presenceClocks.delete(listener)
  }

  connect(peer: string): void {
    if (this.phase.kind === 'left' || peer === this.peer || this.departed.has(peer)) return
    const known = this.members.has(peer)
    if (known && !this.unreachable.delete(peer)) return
    if (!known) {
      if (this.members.size >= 8) throw new RangeError('A session supports up to eight peers')
      this.members.add(peer)
      this.observed.delete(peer)
      this.negotiate()
    }
    this.send(peer, 'HELLO', { ...this.advertisement(this.branch), term: this.maxTerm })
    for (const observer of this.presenceObservers) observer.connected()
  }

  disconnect(peer: string): void {
    if (this.phase.kind === 'left' || !this.members.has(peer) || this.unreachable.has(peer)) return
    this.unreachable.set(peer, this.now)
  }

  private removeMember(peer: string): void {
    this.unreachable.delete(peer)
    if (!this.members.delete(peer) || this.phase.kind === 'left') return
    this.observed.delete(peer)
    for (const observer of this.presenceObservers) observer.leave(peer)
    if (this.phase.kind === 'stable' && peer !== this.authority.host) return
    this.negotiate()
  }

  retire(peer: string): void {
    if (peer === this.peer) throw new TypeError('A session can retire only a remote peer')
    this.departed.add(peer)
    this.removeMember(peer)
    this.seen.delete(peer)
    this.transfers.delete(peer)
  }

  submit(edit: E): void {
    if (this.phase.kind === 'left') throw new TypeError('The session has left the room')
    if (edit.document !== this.options.document)
      throw new TypeError('The edit belongs to another document')
    if (this.options.engine.outcome(edit.id) || this.pending.has(editKey(edit.id))) return
    this.pending.set(editKey(edit.id), edit)
  }

  tick(now: number): void {
    this.now = now
    for (const [peer, since] of this.unreachable)
      if (now - since >= this.options.suspicionTimeout) this.removeMember(peer)
    for (const listener of this.presenceClocks) listener(now)
    if (this.phase.kind === 'left' || now - this.lastTick < this.options.pulseInterval) return
    this.lastTick = now
    if (
      this.phase.kind === 'stable' &&
      now - this.lastHostPulse > this.options.suspicionTimeout &&
      this.authority.host !== this.peer &&
      !this.unreachable.has(this.authority.host)
    )
      this.negotiate()
    if (!this.isHost && this.phase.kind !== 'handoff')
      this.broadcast('HELLO', { ...this.advertisement(this.branch), term: this.maxTerm })
    this.retryPhase()
    this.flushPending()
    this.resumeDeparture()
  }

  receive(message: Message<E>): boolean {
    if (
      this.phase.kind === 'left' ||
      message.version !== 1 ||
      message.room !== this.options.room ||
      message.document !== this.options.document ||
      !Number.isSafeInteger(message.messageId) ||
      message.messageId < 1
    )
      return false
    if (!this.members.has(message.sender) || message.sender === this.peer) return false
    const seen = this.seen.get(message.sender) ?? new ReplayWindow(this.replayWindowSize)
    if (!seen.accept(message.messageId)) return false
    this.seen.set(message.sender, seen)
    switch (message.type) {
      case 'HELLO':
        this.maxTerm = Math.max(this.maxTerm, message.payload.term)
        this.observe(
          message.sender,
          message.payload.branch,
          message.messageId,
          message.payload.members,
          message.payload.handoff,
        )
        break
      case 'HOST_PULSE':
        if (message.sender !== message.payload.branch.authority.host) break
        this.observe(
          message.sender,
          message.payload.branch,
          message.messageId,
          message.payload.members,
          message.payload.handoff,
        )
        if (sameAuthority(this.authority, message.payload.branch.authority)) {
          this.lastHostPulse = this.now
          if (this.lastCommit) this.claim(message.sender, this.lastCommit)
          this.observe(message.sender, message.payload.branch)
        }
        break
      case 'ELECTION_OFFER':
      case 'RECONCILE_OFFER':
        this.offer(message.sender, message.payload)
        break
      case 'RECONCILE_COMMIT':
        this.prepareCommit(message.sender, message.payload)
        break
      case 'HOST_CLAIM':
        this.claim(message.sender, message.payload)
        break
      case 'SUBMIT':
        if (this.isHost && sameAuthority(this.authority, message.payload.authority))
          for (const edit of message.payload.edits) this.submit(edit)
        break
      case 'CONFIRM':
        this.confirm(message.sender, message.payload)
        break
      case 'HAVE':
        this.have(message.sender, message.payload)
        break
      case 'HISTORY_REQUEST':
        this.exportTo(message.sender, message.payload)
        break
      case 'HISTORY_CHUNK':
        this.importFrom(message.sender, message.payload)
        break
      case 'HANDOFF':
        this.handoff(message.sender, message.payload)
        break
      case 'LEAVE':
        for (const observer of this.presenceObservers) observer.leave(message.sender)
        this.departed.add(message.sender)
        this.unreachable.delete(message.sender)
        this.members.delete(message.sender)
        this.observed.delete(message.sender)
        this.seen.delete(message.sender)
        this.transfers.delete(message.sender)
        if (
          this.authority.host === message.sender ||
          this.phase.kind === 'collecting' ||
          this.phase.kind === 'activating'
        )
          this.negotiate()
        break
      case 'PRESENCE':
        for (const observer of this.presenceObservers)
          observer.receive(message.sender, message.payload)
        this.options.onPresence?.(message.sender, message.payload)
        break
    }
    return true
  }

  leave(successor?: string): void {
    if (this.status === 'left') return
    if (successor === undefined) {
      for (const observer of this.presenceObservers) observer.leave(this.peer)
      this.departure = this.peer
      if (this.pending.size === 0) {
        this.broadcast('LEAVE', { successor: null })
        this.completeDeparture()
      }
      return
    }
    if (!this.isHost || !this.members.has(successor) || successor === this.peer)
      throw new TypeError('Handoff needs a connected successor and a stable host')
    for (const observer of this.presenceObservers) observer.leave(this.peer)
    this.departure = successor
    this.startHandoff(successor)
  }

  private startHandoff(successor: string): void {
    const next = {
      term: this.maxTerm + 1,
      host: successor,
      epoch: JSON.stringify([this.peer, ++this.serial, 'handoff']),
    }
    this.phase = {
      kind: 'handoff',
      successor,
      branch: this.branch,
      next,
      committed: false,
      acknowledgements: new Set(),
      transferred: new Set(),
    }
    this.retryPhase()
  }

  private advertisement(branch: Branch): Payloads<E>['HOST_PULSE'] {
    return { branch, members: this.roster(), handoff: this.lastHandoff }
  }

  private roster(): string[] {
    return this.liveRoster([...this.members])
  }
  private liveRoster(members: readonly string[]): string[] {
    return members.filter((peer) => !this.departed.has(peer)).sort(compareIds)
  }
  private compatibleMembership(): boolean {
    const roster = this.roster()
    const key = JSON.stringify(roster)
    return roster.every(
      (peer) =>
        peer === this.peer ||
        JSON.stringify(this.liveRoster(this.observed.get(peer)?.members ?? [])) === key,
    )
  }
  private completeDeparture(): void {
    this.phase = { kind: 'left' }
    this.unreachable.clear()
    this.seen.clear()
    this.transfers.clear()
    this.departure = undefined
    for (const observer of this.presenceObservers) observer.departed()
  }

  private resumeDeparture(): void {
    if (!this.departure || this.phase.kind !== 'stable' || !this.host) return
    if (this.departure === this.peer) {
      if (this.pending.size) return
      this.broadcast('LEAVE', { successor: null })
      this.completeDeparture()
      return
    }
    if (this.isHost) {
      const successor = this.members.has(this.departure)
        ? this.departure
        : this.roster().find((peer) => peer !== this.peer)
      if (successor) this.startHandoff(successor)
      return
    }
    if (this.pending.size) return
    this.broadcast('LEAVE', { successor: this.departure })
    this.completeDeparture()
  }
  private coordinator(): string {
    return this.roster()[0]!
  }
  private validRound(round: Round): boolean {
    return (
      round.coordinator === this.coordinator() &&
      JSON.stringify(round.roster) === JSON.stringify(this.roster())
    )
  }

  private negotiate(): void {
    this.commitWaiting = undefined
    this.lastCommit = undefined
    this.lastHandoff = undefined
    this.incomingHandoff = undefined
    this.phase = { kind: 'waiting' }
    if (this.coordinator() !== this.peer) {
      this.send(this.coordinator(), 'ELECTION_OFFER', {
        round: null,
        branch: this.branch,
        term: this.maxTerm,
      })
      return
    }
    const round = { coordinator: this.peer, serial: ++this.serial, roster: this.roster() }
    this.beginRound(round)
  }

  private beginRound(round: Round): void {
    this.commitWaiting = undefined
    this.lastCommit = undefined
    this.incomingHandoff = undefined
    this.lastHandoff = undefined
    this.latestRounds.set(round.coordinator, round.serial)
    const own = { round, branch: this.branch, term: this.maxTerm }
    this.phase = { kind: 'collecting', round, offers: new Map([[this.peer, own]]) }
    this.broadcast('ELECTION_OFFER', own)
    this.finishRound()
  }

  private offer(peer: string, offer: Offer): void {
    this.maxTerm = Math.max(this.maxTerm, offer.term)
    if (!offer.round) {
      if (this.coordinator() !== this.peer) return
      if (this.phase.kind === 'waiting') this.negotiate()
      if (
        (this.phase.kind === 'stable' || this.phase.kind === 'activating') &&
        sameAuthority(offer.branch.authority, this.authority)
      )
        this.negotiate()
      return
    }
    const round = offer.round
    if (!this.validRound(round)) return
    if (round.serial < (this.latestRounds.get(round.coordinator) ?? 0)) return
    if (this.phase.kind !== 'collecting' || roundKey(this.phase.round) !== roundKey(round)) {
      if (round.serial === this.latestRounds.get(round.coordinator)) return
      if (peer !== round.coordinator) return
      this.beginRound(round)
    }
    if (this.phase.kind !== 'collecting') return
    this.phase.offers.set(peer, offer)
    if (this.coordinator() === this.peer) this.request(peer, offer.branch.tip)
    this.finishRound()
  }

  private finishRound(): void {
    if (
      this.phase.kind !== 'collecting' ||
      this.coordinator() !== this.peer ||
      !this.compatibleMembership()
    )
      return
    const { round, offers } = this.phase
    if (round.roster.some((peer) => !offers.has(peer))) return
    const entries = round.roster.map((peer) => ({ peer, branch: offers.get(peer)!.branch }))
    if (entries.some((entry) => !this.historyAt(entry.branch.tip))) return
    const histories = entries.map((entry) => this.historyAt(entry.branch.tip)!)
    const linear = inOneLineage(histories)
    const sorted = entries.sort((a, b) => {
      if (linear) return b.branch.tip.depth - a.branch.tip.depth || compareIds(a.peer, b.peer)
      return compareBranches(a.branch, b.branch) || compareIds(a.peer, b.peer)
    })
    const winner = sorted[0]!
    const base = this.historyAt(winner.branch.tip)!
    const represented = new Set(base.map((record) => editKey(record.id)))
    const replay = new Map<string, E>()
    for (const history of histories) {
      for (const record of history) {
        if (!represented.has(editKey(record.id))) replay.set(editKey(record.id), record.edit)
      }
    }
    const term = Math.max(this.maxTerm, ...Array.from(offers.values(), (offer) => offer.term)) + 1
    const authority = { host: winner.peer, term, epoch: roundKey(round) }
    const commit = {
      round,
      authority,
      base: winner.branch,
      offers: entries,
      replay: [...replay.values()],
    }
    this.installCommit(commit)
    this.broadcast('RECONCILE_COMMIT', commit)
  }

  private prepareCommit(peer: string, commit: Commit<E>): void {
    if (peer !== commit.round.coordinator || !this.validCommit(commit)) return
    if (this.lastCommit?.authority.epoch === commit.authority.epoch) {
      this.broadcast('HAVE', { tip: commit.base.tip, epoch: commit.authority.epoch })
      return
    }
    this.commitWaiting = commit
    this.request(peer, commit.base.tip)
    this.tryCommit()
  }

  private validCommit(commit: Commit<E>): boolean {
    if (!this.validRound(commit.round)) return false
    if (commit.round.serial !== this.latestRounds.get(commit.round.coordinator)) return false
    if (this.phase.kind !== 'collecting')
      return this.lastCommit?.authority.epoch === commit.authority.epoch
    const own = commit.offers.find((offer) => offer.peer === this.peer)
    return !!own && sameTip(own.branch.tip, this.branch.tip)
  }

  private tryCommit(): void {
    if (!this.commitWaiting || !this.historyAt(this.commitWaiting.base.tip)) return
    if (!this.validCommit(this.commitWaiting)) {
      this.commitWaiting = undefined
      return
    }
    this.installCommit(this.commitWaiting)
    this.commitWaiting = undefined
  }

  private installCommit(commit: Commit<E>): void {
    const engine = this.options.engine
    const old = engine.exportHistory(this.options.genesis)!
    const base = this.historyAt(commit.base.tip)!
    if (!sameTip(this.branch.tip, commit.base.tip))
      this.archives.push({ branch: this.branch, history: old })
    engine.install(base, commit.replay)
    for (const edit of engine.uniquePending(old)) this.pending.set(editKey(edit.id), edit)
    for (const edit of commit.replay) this.pending.set(editKey(edit.id), edit)
    this.settlePending()
    this.authority = commit.authority
    this.maxTerm = Math.max(this.maxTerm, commit.authority.term)
    this.lastCommit = commit
    this.phase = { kind: 'activating', commit, acknowledgements: new Set([this.peer]) }
    this.broadcast('HAVE', { tip: commit.base.tip, epoch: commit.authority.epoch })
    this.activate()
  }

  private have(peer: string, payload: Payloads<E>['HAVE']): void {
    if (this.phase.kind === 'handoff') {
      this.haveHandoff(peer, payload)
      return
    }
    if (
      this.phase.kind !== 'activating' ||
      payload.epoch !== this.authority.epoch ||
      !sameTip(payload.tip, this.phase.commit.base.tip)
    )
      return
    this.phase.acknowledgements.add(peer)
    this.activate()
  }

  private haveHandoff(peer: string, payload: Payloads<E>['HAVE']): void {
    if (this.phase.kind !== 'handoff' || !payload.handoffStage) return
    if (!sameTip(payload.tip, this.phase.branch.tip) || payload.epoch !== this.phase.next.epoch)
      return
    const { transferred, acknowledgements, successor } = this.phase
    if (peer === successor) for (const id of payload.pending) transferred.add(editKey(id))
    if (!this.phase.committed) {
      if (peer !== successor || [...this.pending.keys()].some((id) => !transferred.has(id))) return
      this.phase = { ...this.phase, committed: true }
      this.retryPhase()
    }
    if (payload.handoffStage === 'commit') acknowledgements.add(peer)
    if ([...this.pending.keys()].some((id) => !transferred.has(id))) return
    if (this.roster().some((member) => member !== this.peer && !acknowledgements.has(member)))
      return
    this.broadcast('LEAVE', { successor })
    this.pending.clear()
    this.completeDeparture()
  }

  private activate(): void {
    if (
      this.phase.kind !== 'activating' ||
      this.authority.host !== this.peer ||
      !this.compatibleMembership()
    )
      return
    const { commit, acknowledgements } = this.phase
    if (commit.round.roster.some((peer) => !acknowledgements.has(peer))) return
    this.phase = { kind: 'stable' }
    this.lastHostPulse = this.now
    this.broadcast('HOST_CLAIM', commit)
  }

  private claim(peer: string, commit: Commit<E>): void {
    if (
      peer !== commit.authority.host ||
      this.lastCommit?.authority.epoch !== commit.authority.epoch
    )
      return
    if (
      (this.phase.kind !== 'activating' && this.phase.kind !== 'stable') ||
      !this.compatibleMembership()
    )
      return
    this.phase = { kind: 'stable' }
    this.lastHostPulse = this.now
  }

  private observe(
    peer: string,
    branch: Branch,
    messageId?: number,
    members?: readonly string[],
    handoff?: Payloads<E>['HANDOFF'],
  ): void {
    const previous = this.observed.get(peer)
    if (messageId !== undefined && messageId < (previous?.messageId ?? 0)) return
    if (messageId !== undefined) this.observed.set(peer, { messageId, branch, members: members! })
    if (handoff && sameAuthority(handoff.authority, branch.authority)) this.handoff(peer, handoff)
    this.finishRound()
    this.activate()
    this.maxTerm = Math.max(this.maxTerm, branch.authority.term)
    if (this.phase.kind !== 'stable' || !this.compatibleMembership()) return
    if (this.lastHandoff?.branch.authority.host === peer) return
    this.request(
      peer,
      branch.tip,
      sameAuthority(this.authority, branch.authority) ? this.authority.epoch : undefined,
    )
    if (!sameAuthority(this.authority, branch.authority)) {
      const history = this.historyAt(branch.tip)
      if (!history) return
      // Retired branches already absorbed into the base or replay cannot reopen reconciliation.
      if (
        branch.authority.term < this.authority.term &&
        history.every(
          (record) =>
            this.options.engine.outcome(record.id) || this.pending.has(editKey(record.id)),
        )
      )
        return
      this.negotiate()
      return
    }
    this.sync(branch)
  }

  private sync(branch: Branch): void {
    const history = this.historyAt(branch.tip)
    if (!history) return
    const engine = this.options.engine
    const own = engine.exportHistory(this.options.genesis)!
    if (!inOneLineage([own, history])) {
      this.negotiate()
      return
    }
    const records = history.slice(own.length)
    if (!engine.applyBatch(records)) {
      this.negotiate()
      return
    }
    for (const record of records) this.pending.delete(editKey(record.id))
    this.rememberLocal()
  }

  private confirm(peer: string, payload: Payloads<E>['CONFIRM']): void {
    if (
      this.phase.kind !== 'stable' ||
      peer !== this.authority.host ||
      !sameAuthority(payload.authority, this.authority)
    )
      return
    const tip = this.options.engine.checkpoint()
    const own = this.options.engine.exportHistory(this.options.genesis)!
    const records: Confirmation<E>[] = []
    let depth = tip.depth
    for (const record of payload.records) {
      if (record.depth <= tip.depth) {
        if (own[record.depth - 1]?.hash !== record.hash) {
          this.negotiate()
          return
        }
        continue
      }
      if (record.depth !== depth + 1) {
        const last = payload.records.at(-1)!
        this.request(peer, { depth: last.depth, hash: last.hash }, this.authority.epoch)
        return
      }
      records.push(record)
      depth = record.depth
    }
    if (!records.length) return
    if (!this.options.engine.applyBatch(records)) {
      this.negotiate()
      return
    }
    for (const record of records) this.pending.delete(editKey(record.id))
    this.rememberLocal()
    this.send(peer, 'HAVE', { tip: this.branch.tip, epoch: this.authority.epoch })
  }

  private flushPending(): void {
    if (this.phase.kind !== 'stable' || !this.compatibleMembership()) return
    const count = Math.min(
      this.pending.size,
      Math.max(1, Math.floor(this.replayWindowSize / this.members.size)),
    )
    if (!this.isHost) {
      const edits: E[] = []
      for (let index = 0; index < count && this.pending.size; index++) {
        const [key, edit] = this.pending.entries().next().value!
        this.pending.delete(key)
        this.pending.set(key, edit)
        edits.push(edit)
      }
      for (const batch of this.batches(edits))
        this.send(this.authority.host, 'SUBMIT', { authority: this.authority, edits: batch })
      return
    }
    const ready = [...this.pending.values()].sort(
      (a, b) => a.lamport - b.lamport || compareIds(editKey(a.id), editKey(b.id)),
    )
    const sequenced = new Set<string>()
    const commands: { edit: E; rejection?: string }[] = []
    for (const edit of ready) {
      if (commands.length === count) break
      const key = editKey(edit.id)
      const missing = edit.deps.some(
        (id) => !this.options.engine.outcome(id) && !sequenced.has(editKey(id)),
      )
      const since = this.blockedSince.get(key) ?? this.now
      if (missing) this.blockedSince.set(key, since)
      if (missing && this.now - since < this.options.dependencyTimeout) continue
      commands.push({ edit, rejection: missing ? 'Dependency unavailable' : undefined })
      sequenced.add(key)
    }
    if (!commands.length) return
    const records = this.options.engine.sequenceBatch(commands)
    for (const record of records) {
      const key = editKey(record.id)
      this.pending.delete(key)
      this.blockedSince.delete(key)
    }
    this.rememberLocal()
    for (const batch of this.batches(records))
      this.broadcast('CONFIRM', { authority: this.authority, records: batch })
  }

  private batches<T>(values: readonly T[]): readonly (readonly T[])[] {
    const batches: T[][] = []
    const encoder = new TextEncoder()
    let batch: T[] = []
    let bytes = 0
    for (const value of values) {
      const size = encoder.encode(JSON.stringify(value)).byteLength
      // Reserve space for session headers and transport wrappers around the opaque records.
      if (batch.length && bytes + size > MESSAGE_LIMIT / 2) {
        batches.push(batch)
        batch = []
        bytes = 0
      }
      batch.push(value)
      bytes += size + 1
    }
    if (batch.length) batches.push(batch)
    return batches
  }

  private retryPhase(): void {
    if (this.phase.kind === 'waiting') {
      if (this.incomingHandoff) {
        this.request(this.incomingHandoff.branch.authority.host, this.incomingHandoff.branch.tip)
        this.tryHandoff()
        return
      }
      if (this.coordinator() === this.peer) this.negotiate()
      else
        this.send(this.coordinator(), 'ELECTION_OFFER', {
          round: null,
          branch: this.branch,
          term: this.maxTerm,
        })
      return
    }
    if (this.phase.kind === 'collecting') {
      this.broadcast('RECONCILE_OFFER', this.phase.offers.get(this.peer)!)
      if (this.coordinator() === this.peer)
        for (const [peer, offer] of this.phase.offers) this.request(peer, offer.branch.tip)
      this.finishRound()
      return
    }
    if (this.phase.kind === 'activating') {
      if (this.coordinator() === this.peer) this.broadcast('RECONCILE_COMMIT', this.phase.commit)
      this.broadcast('HAVE', { tip: this.phase.commit.base.tip, epoch: this.authority.epoch })
      return
    }
    if (this.phase.kind === 'handoff') {
      if (this.lastHandoff) this.broadcast('HANDOFF', this.lastHandoff)
      this.broadcast('HOST_PULSE', this.advertisement(this.phase.branch))
      const handoff: Payloads<E>['HANDOFF'] = {
        stage: this.phase.committed ? 'commit' : 'prepare',
        successor: this.phase.successor,
        branch: this.phase.branch,
        authority: this.phase.next,
        pending: [...this.pending.values()],
      }
      this.broadcast('HANDOFF', handoff)
      return
    }
    // Roster discovery pauses sequencing while the installed host keeps renewing its authority.
    if (this.authority.host !== this.peer) return
    if (this.lastHandoff) this.broadcast('HANDOFF', this.lastHandoff)
    this.broadcast('HOST_PULSE', this.advertisement(this.branch))
  }

  private rememberLocal(): void {
    const history = this.options.engine.exportHistory(this.options.genesis)!
    this.rememberHistory(this.branch.tip, history)
  }

  private historyAt(tip: Checkpoint): readonly Confirmation<E>[] | undefined {
    const exact = this.histories.get(tipKey(tip))
    if (exact) return exact
    for (const history of this.histories.values()) {
      const point = tip.depth === 0 ? this.options.genesis : history[tip.depth - 1]
      if (point && sameTip(point, tip)) return history.slice(0, tip.depth)
    }
  }

  private rememberHistory(tip: Checkpoint, history: readonly Confirmation<E>[]): void {
    if (this.historyAt(tip)) return
    for (const [key, retained] of this.histories) {
      const last = retained.at(-1) ?? this.options.genesis
      const point = last.depth === 0 ? this.options.genesis : history[last.depth - 1]
      if (point && sameTip(point, last)) this.histories.delete(key)
    }
    this.histories.set(tipKey(tip), history)
  }

  private request(peer: string, tip: Checkpoint, scope?: string): void {
    if (this.historyAt(tip) || peer === this.peer) return
    const own = this.branch.tip
    const local = this.options.engine.exportHistory(this.options.genesis)!
    const checkpoint = tip.depth === 0 ? this.options.genesis : local[tip.depth - 1]
    if (checkpoint && sameTip(checkpoint, tip)) {
      this.rememberHistory(tip, local.slice(0, tip.depth))
      return
    }
    const previous = this.transfers.get(peer)
    if (
      previous &&
      scope !== undefined &&
      previous.scope === scope &&
      !sameTip(previous.tip, tip) &&
      !this.historyAt(previous.tip)
    ) {
      this.request(peer, previous.tip, scope)
      return
    }
    let transfer = previous
    if (!transfer || !sameTip(transfer.tip, tip) || transfer.scope !== scope) {
      let from = own.depth <= tip.depth ? own : this.options.genesis
      if (previous && previous.scope === scope && previous.tip.depth <= tip.depth)
        from = this.transferPrefix(previous, from)
      transfer = {
        tip,
        scope,
        from,
        chunks: new Map<number, readonly Confirmation<E>[]>(),
        next: 0,
        nextRequest: 0,
        requested: new Map<number, number>(),
      }
      this.transfers.set(peer, transfer)
    }
    for (const [index, requestedAt] of transfer.requested) {
      if (this.now - requestedAt < this.options.pulseInterval) continue
      transfer.requested.set(index, this.now)
      this.send(peer, 'HISTORY_REQUEST', { tip, from: transfer.from, index })
    }
    const limit = Math.max(1, Math.floor(this.replayWindowSize / 2))
    const count = transfer.count ?? 1
    while (transfer.requested.size < limit && transfer.nextRequest < count) {
      const index = transfer.nextRequest++
      if (transfer.chunks.has(index)) continue
      transfer.requested.set(index, this.now)
      this.send(peer, 'HISTORY_REQUEST', { tip, from: transfer.from, index })
    }
  }

  private transferHistory(transfer: HistoryTransfer<E>): readonly Confirmation<E>[] | undefined {
    const base = sameTip(transfer.from, this.options.genesis) ? [] : this.historyAt(transfer.from)
    if (!base) return
    return base.concat(
      Array.from({ length: transfer.next }, (_, index) => transfer.chunks.get(index)!).flat(),
    )
  }

  private transferPrefix(transfer: HistoryTransfer<E>, from: Checkpoint): Checkpoint {
    const history = this.transferHistory(transfer)
    const last = history?.at(-1)
    const tip = last ? { depth: last.depth, hash: last.hash } : this.options.genesis
    if (!history || tip.depth <= from.depth || !this.options.engine.verify(history, tip))
      return from
    this.rememberHistory(tip, history)
    return tip
  }

  private exportTo(peer: string, payload: Payloads<E>['HISTORY_REQUEST']): void {
    const history = this.historyAt(payload.tip)
    if (!history) return
    const prefix = payload.from.depth === 0 ? this.options.genesis : history[payload.from.depth - 1]
    const from = prefix && sameTip(prefix, payload.from) ? payload.from : this.options.genesis
    const size = this.options.historyChunkRecords
    const count = Math.max(1, Math.ceil((history.length - from.depth) / size))
    const { index } = payload
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) return
    this.send(peer, 'HISTORY_CHUNK', {
      ...payload,
      from,
      count,
      records: history.slice(from.depth + index * size, from.depth + (index + 1) * size),
    })
  }

  private importFrom(peer: string, payload: Payloads<E>['HISTORY_CHUNK']): void {
    if (
      !Number.isSafeInteger(payload.count) ||
      payload.count < 1 ||
      !Number.isSafeInteger(payload.index) ||
      payload.index < 0 ||
      payload.index >= payload.count ||
      this.historyAt(payload.tip)
    )
      return
    const transfer = this.transfers.get(peer)
    if (!transfer || !sameTip(transfer.tip, payload.tip) || transfer.chunks.has(payload.index))
      return
    const base = sameTip(payload.from, this.options.genesis) ? [] : this.historyAt(payload.from)
    if (!base) return
    if (
      transfer.count !== undefined &&
      (transfer.count !== payload.count || !sameTip(transfer.from, payload.from))
    )
      return
    transfer.from = payload.from
    transfer.count = payload.count
    transfer.chunks.set(payload.index, payload.records)
    transfer.requested.delete(payload.index)
    const previousNext = transfer.next
    while (transfer.chunks.has(transfer.next)) transfer.next++
    if (transfer.next !== payload.count) {
      if (
        transfer.next > previousNext &&
        this.phase.kind === 'stable' &&
        transfer.scope === this.authority.epoch
      ) {
        const tip = this.transferPrefix(transfer, this.branch.tip)
        this.sync({ tip, authority: this.authority })
      }
      this.request(peer, payload.tip, transfer.scope)
      return
    }
    const history = this.transferHistory(transfer)!
    this.transfers.delete(peer)
    if (!this.options.engine.verify(history, payload.tip)) return
    this.rememberHistory(payload.tip, history)
    if (this.phase.kind === 'stable' && transfer.scope === this.authority.epoch)
      this.sync({ tip: payload.tip, authority: this.authority })
    this.finishRound()
    this.tryCommit()
    this.tryHandoff()
    // A delayed transfer can belong to an archived branch; only a current advertisement drives sync.
    const advertised = this.observed.get(peer)?.branch
    if (
      advertised &&
      (sameTip(advertised.tip, payload.tip) || transfer.scope === advertised.authority.epoch)
    )
      this.observe(peer, advertised)
  }

  private handoff(peer: string, payload: Payloads<E>['HANDOFF']): void {
    if (
      this.phase.kind === 'handoff' ||
      this.phase.kind === 'collecting' ||
      this.phase.kind === 'activating'
    )
      return
    if (payload.authority.epoch === this.authority.epoch) {
      if (payload.stage !== 'commit' || payload.successor !== this.authority.host) return
      const edits = new Map<string, E>()
      for (const edit of (this.lastHandoff?.pending ?? []).concat(payload.pending))
        edits.set(editKey(edit.id), edit)
      const added = edits.size !== (this.lastHandoff?.pending.length ?? 0)
      this.lastHandoff = { ...payload, pending: [...edits.values()] }
      for (const edit of payload.pending) this.submit(edit)
      this.acknowledgeHandoff(payload)
      if (added && this.peer === payload.successor) this.broadcast('HANDOFF', this.lastHandoff)
      if (peer !== payload.successor && this.peer !== payload.successor)
        this.send(payload.successor, 'HANDOFF', this.lastHandoff)
      return
    }
    const relayed = sameAuthority(payload.branch.authority, this.authority)
    if (peer !== this.authority.host && !relayed) return
    if (payload.authority.term <= this.authority.term) return
    if (payload.stage === 'prepare' && payload.successor !== this.peer) {
      this.lastHostPulse = this.now
      this.send(payload.successor, 'HANDOFF', payload)
      return
    }
    this.phase = { kind: 'waiting' }
    this.incomingHandoff = payload
    const source = payload.stage === 'prepare' ? peer : payload.successor
    this.request(source, payload.branch.tip)
    this.tryHandoff()
  }

  private tryHandoff(): void {
    const handoff = this.incomingHandoff
    if (!handoff) return
    const history = this.historyAt(handoff.branch.tip)
    if (!history) return
    const old = this.options.engine.exportHistory(this.options.genesis)!
    this.options.engine.install(history, handoff.pending)
    this.settlePending()
    for (const edit of this.options.engine.uniquePending(old)) this.submit(edit)
    for (const edit of handoff.pending) this.submit(edit)
    if (handoff.stage === 'prepare') {
      this.acknowledgeHandoff(handoff)
      return
    }
    this.authority = handoff.authority
    this.maxTerm = Math.max(this.maxTerm, handoff.authority.term)
    this.phase = { kind: 'stable' }
    this.lastHostPulse = this.now
    this.incomingHandoff = undefined
    this.lastCommit = undefined
    this.lastHandoff = handoff
    this.acknowledgeHandoff(handoff)
    if (this.peer === handoff.successor) this.broadcast('HANDOFF', handoff)
    else this.send(handoff.successor, 'HANDOFF', handoff)
  }

  private settlePending(): void {
    for (const [key, edit] of this.pending) {
      if (!this.options.engine.outcome(edit.id)) continue
      this.pending.delete(key)
      this.blockedSince.delete(key)
    }
  }

  private acknowledgeHandoff(handoff: Payloads<E>['HANDOFF']): void {
    const peer = handoff.branch.authority.host
    if (!this.members.has(peer)) return
    const acknowledgement = {
      tip: handoff.branch.tip,
      epoch: handoff.authority.epoch,
      handoffStage: handoff.stage,
      pending: handoff.pending.map((edit) => edit.id),
    }
    this.send(peer, 'HAVE', acknowledgement)
  }

  private send<K extends keyof Payloads<E>>(peer: string, type: K, payload: Payloads<E>[K]): void {
    const message = {
      version: 1,
      room: this.options.room,
      document: this.options.document,
      sender: this.peer,
      messageId: ++this.messageId,
      epoch: this.authority.epoch,
      type,
      payload,
    } as Message<E>
    this.options.send(peer, message)
  }

  private broadcast<K extends keyof Payloads<E>>(type: K, payload: Payloads<E>[K]): void {
    for (const peer of this.members) if (peer !== this.peer) this.send(peer, type, payload)
  }
}
