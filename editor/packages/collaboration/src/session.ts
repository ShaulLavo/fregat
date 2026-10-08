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
  readonly onPresence?: (peer: string, payload: Payloads<E>['PRESENCE']) => void
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
  private phase: Phase<E> = { kind: 'waiting' }
  private authority: Authority
  private maxTerm = 0
  private serial = 0
  private messageId = 0
  private lastTick = -Infinity
  private lastHostPulse = -Infinity
  private now = 0
  private readonly seen = new Map<string, Set<number>>()
  private readonly histories = new Map<string, readonly Confirmation<E>[]>()
  private readonly latestRounds = new Map<string, number>()
  private readonly chunks = new Map<string, Map<number, readonly Confirmation<E>[]>>()
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

  connect(peer: string): void {
    if (
      this.phase.kind === 'left' ||
      peer === this.peer ||
      this.members.has(peer) ||
      this.departed.has(peer)
    )
      return
    if (this.members.size >= 8) throw new RangeError('A session supports up to eight peers')
    this.members.add(peer)
    this.observed.delete(peer)
    this.negotiate()
    this.send(peer, 'HELLO', { ...this.advertisement(this.branch), term: this.maxTerm })
  }

  disconnect(peer: string): void {
    if (!this.members.delete(peer) || this.phase.kind === 'left') return
    this.observed.delete(peer)
    if (this.phase.kind === 'stable' && peer !== this.authority.host) return
    this.negotiate()
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
    if (this.phase.kind === 'left' || now - this.lastTick < this.options.pulseInterval) return
    this.lastTick = now
    if (
      this.phase.kind === 'stable' &&
      now - this.lastHostPulse > this.options.suspicionTimeout &&
      !this.isHost
    )
      this.negotiate()
    this.broadcast('HELLO', { ...this.advertisement(this.branch), term: this.maxTerm })
    this.retryPhase()
    this.flushPending()
    this.resumeDeparture()
  }

  receive(message: Message<E>): void {
    if (
      this.phase.kind === 'left' ||
      message.version !== 1 ||
      message.room !== this.options.room ||
      message.document !== this.options.document
    )
      return
    if (!this.members.has(message.sender) || message.sender === this.peer) return
    const seen = this.seen.get(message.sender) ?? new Set<number>()
    if (seen.has(message.messageId)) return
    seen.add(message.messageId)
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
        if (sameAuthority(this.authority, message.payload.branch.authority))
          this.lastHostPulse = this.now
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
          this.submit(message.payload.edit)
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
        this.departed.add(message.sender)
        this.members.delete(message.sender)
        this.observed.delete(message.sender)
        if (
          this.authority.host === message.sender ||
          this.phase.kind === 'collecting' ||
          this.phase.kind === 'activating'
        )
          this.negotiate()
        break
      case 'PRESENCE':
        this.options.onPresence?.(message.sender, message.payload)
        break
    }
  }

  leave(successor: string): void {
    if (!this.isHost || !this.members.has(successor) || successor === this.peer)
      throw new TypeError('Handoff needs a connected successor and a stable host')
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
  private resumeDeparture(): void {
    if (!this.departure || this.phase.kind !== 'stable' || !this.host) return
    if (this.isHost) {
      const successor = this.members.has(this.departure)
        ? this.departure
        : this.roster().find((peer) => peer !== this.peer)
      if (successor) this.startHandoff(successor)
      return
    }
    if (this.pending.size) return
    this.broadcast('LEAVE', { successor: this.departure })
    this.phase = { kind: 'left' }
    this.departure = undefined
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
    this.request(peer, offer.branch.tip)
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
    if (entries.some((entry) => !this.histories.has(tipKey(entry.branch.tip)))) return
    const histories = entries.map((entry) => this.histories.get(tipKey(entry.branch.tip))!)
    const linear = inOneLineage(histories)
    const sorted = entries.toSorted((a, b) => {
      if (linear) return b.branch.tip.depth - a.branch.tip.depth || compareIds(a.peer, b.peer)
      return compareBranches(a.branch, b.branch) || compareIds(a.peer, b.peer)
    })
    const winner = sorted[0]!
    const base = this.histories.get(tipKey(winner.branch.tip))!
    const represented = new Set(base.map((record) => editKey(record.id)))
    const replay = new Map<string, E>()
    for (const history of histories) {
      for (const record of history) {
        if (!represented.has(editKey(record.id))) replay.set(editKey(record.id), record.edit)
      }
    }
    const term = Math.max(this.maxTerm, ...[...offers.values()].map((offer) => offer.term)) + 1
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
    if (!this.commitWaiting || !this.histories.has(tipKey(this.commitWaiting.base.tip))) return
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
    const base = this.histories.get(tipKey(commit.base.tip))!
    if (!sameTip(this.branch.tip, commit.base.tip))
      this.archives.push({ branch: this.branch, history: old })
    engine.install(base)
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
    this.phase = { kind: 'left' }
    this.departure = undefined
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
    this.request(peer, branch.tip)
    if (this.phase.kind !== 'stable' || !this.compatibleMembership()) return
    if (this.lastHandoff?.branch.authority.host === peer) return
    if (!sameAuthority(this.authority, branch.authority)) {
      const history = this.histories.get(tipKey(branch.tip))
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
    const history = this.histories.get(tipKey(branch.tip))
    if (!history) return
    const engine = this.options.engine
    const own = engine.exportHistory(this.options.genesis)!
    if (!inOneLineage([own, history])) {
      this.negotiate()
      return
    }
    for (const record of history.slice(own.length)) {
      if (!engine.apply(record)) {
        this.negotiate()
        return
      }
      this.pending.delete(editKey(record.id))
    }
    this.rememberLocal()
  }

  private confirm(peer: string, payload: Payloads<E>['CONFIRM']): void {
    if (
      this.phase.kind !== 'stable' ||
      peer !== this.authority.host ||
      !sameAuthority(payload.authority, this.authority)
    )
      return
    const { record } = payload
    const tip = this.options.engine.checkpoint()
    if (record.depth <= tip.depth) {
      const own = this.options.engine.exportHistory(this.options.genesis)!
      if (own[record.depth - 1]?.hash !== record.hash) this.negotiate()
      return
    }
    if (record.depth > tip.depth + 1) {
      this.request(peer, { depth: record.depth, hash: record.hash })
      return
    }
    if (!this.options.engine.apply(record)) {
      this.negotiate()
      return
    }
    this.pending.delete(editKey(record.id))
    this.rememberLocal()
    this.send(peer, 'HAVE', { tip: this.branch.tip, epoch: this.authority.epoch })
  }

  private flushPending(): void {
    if (this.phase.kind !== 'stable' || !this.compatibleMembership()) return
    if (!this.isHost) {
      for (const edit of this.pending.values())
        this.send(this.authority.host, 'SUBMIT', { authority: this.authority, edit })
      return
    }
    const ready = [...this.pending.values()].sort(
      (a, b) => a.lamport - b.lamport || compareIds(editKey(a.id), editKey(b.id)),
    )
    for (const edit of ready) {
      const key = editKey(edit.id)
      const missing = edit.deps.some((id) => !this.options.engine.outcome(id))
      const since = this.blockedSince.get(key) ?? this.now
      if (missing) this.blockedSince.set(key, since)
      if (missing && this.now - since < this.options.dependencyTimeout) continue
      const record = this.options.engine.sequence(
        edit,
        missing ? 'Dependency unavailable' : undefined,
      )
      this.pending.delete(key)
      this.blockedSince.delete(key)
      this.rememberLocal()
      this.broadcast('CONFIRM', { authority: this.authority, record })
    }
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
      // A follower can still be awaiting the claim that activated this outgoing host.
      if (this.lastCommit) this.broadcast('HOST_CLAIM', this.lastCommit)
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
    if (!this.isHost) return
    if (this.lastCommit) this.broadcast('HOST_CLAIM', this.lastCommit)
    if (this.lastHandoff) this.broadcast('HANDOFF', this.lastHandoff)
    this.broadcast('HOST_PULSE', this.advertisement(this.branch))
  }

  private rememberLocal(): void {
    const history = this.options.engine.exportHistory(this.options.genesis)!
    this.histories.set(tipKey(this.branch.tip), history)
  }

  private request(peer: string, tip: Checkpoint): void {
    if (this.histories.has(tipKey(tip)) || peer === this.peer) return
    this.send(peer, 'HISTORY_REQUEST', { tip, from: this.options.genesis })
  }

  private exportTo(peer: string, payload: Payloads<E>['HISTORY_REQUEST']): void {
    const history = this.histories.get(tipKey(payload.tip))
    if (!history || !sameTip(payload.from, this.options.genesis)) return
    const size = this.options.historyChunkRecords
    const count = Math.max(1, Math.ceil(history.length / size))
    for (let index = 0; index < count; index++)
      this.send(peer, 'HISTORY_CHUNK', {
        ...payload,
        index,
        count,
        records: history.slice(index * size, (index + 1) * size),
      })
  }

  private importFrom(peer: string, payload: Payloads<E>['HISTORY_CHUNK']): void {
    if (
      !sameTip(payload.from, this.options.genesis) ||
      payload.count < 1 ||
      payload.index < 0 ||
      payload.index >= payload.count
    )
      return
    const key = JSON.stringify([peer, tipKey(payload.tip), payload.count])
    const chunks = this.chunks.get(key) ?? new Map<number, readonly Confirmation<E>[]>()
    chunks.set(payload.index, payload.records)
    this.chunks.set(key, chunks)
    if (chunks.size !== payload.count) return
    const history = Array.from({ length: payload.count }, (_, index) => chunks.get(index)!).flat()
    this.chunks.delete(key)
    if (!this.options.engine.verify(history, payload.tip)) return
    this.histories.set(tipKey(payload.tip), history)
    this.finishRound()
    this.tryCommit()
    this.tryHandoff()
    // A delayed transfer can belong to an archived branch; only a current advertisement drives sync.
    const advertised = this.observed.get(peer)?.branch
    if (advertised && sameTip(advertised.tip, payload.tip)) this.observe(peer, advertised)
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
      for (const edit of [...(this.lastHandoff?.pending ?? []), ...payload.pending])
        edits.set(editKey(edit.id), edit)
      const added = edits.size !== (this.lastHandoff?.pending.length ?? 0)
      this.lastHandoff = { ...payload, pending: [...edits.values()] }
      for (const edit of payload.pending) this.submit(edit)
      this.acknowledgeHandoff(peer, payload)
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
    const history = this.histories.get(tipKey(handoff.branch.tip))
    if (!history) return
    const old = this.options.engine.exportHistory(this.options.genesis)!
    this.options.engine.install(history)
    this.settlePending()
    for (const edit of this.options.engine.uniquePending(old)) this.submit(edit)
    for (const edit of handoff.pending) this.submit(edit)
    if (handoff.stage === 'prepare') {
      this.acknowledgeHandoff(handoff.branch.authority.host, handoff)
      return
    }
    this.authority = handoff.authority
    this.maxTerm = Math.max(this.maxTerm, handoff.authority.term)
    this.phase = { kind: 'stable' }
    this.lastHostPulse = this.now
    this.incomingHandoff = undefined
    this.lastCommit = undefined
    this.lastHandoff = handoff
    this.acknowledgeHandoff(handoff.branch.authority.host, handoff)
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

  private acknowledgeHandoff(peer: string, handoff: Payloads<E>['HANDOFF']): void {
    const acknowledgement = {
      tip: handoff.branch.tip,
      epoch: handoff.authority.epoch,
      handoffStage: handoff.stage,
      pending: handoff.pending.map((edit) => edit.id),
    }
    this.send(peer, 'HAVE', acknowledgement)
    if (peer !== handoff.branch.authority.host)
      this.send(handoff.branch.authority.host, 'HAVE', acknowledgement)
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
