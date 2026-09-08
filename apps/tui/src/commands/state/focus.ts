import {
  createFocusRequestToken,
  createFocusTargetToken,
  resolveFocusTarget,
  type FocusArea,
  type FocusIntent,
  type FocusRequestToken,
  type FocusTargetId,
  type FocusTargetToken,
  type FocusTransitionOutcome,
  type FocusTransitionTicket,
} from '@workspace/client-core/commands/focus'

export type FocusToken = FocusTargetToken
export type FocusScope = {
  readonly screen: string
  readonly environmentId: string
  readonly projectId: string | null
}
export type FocusTarget = FocusScope & {
  readonly id: FocusTargetId
  readonly widgetId: string
  readonly area: FocusArea
  readonly capabilities: { readonly textEntry: boolean; readonly overlay: boolean }
  readonly token: FocusToken
}
export type FocusRegistration = FocusScope & {
  readonly available?: boolean
  readonly id: string
  readonly area: FocusArea
  readonly textEntry: boolean
  readonly overlay?: boolean
  readonly focus: (intent: FocusIntent) => boolean
  readonly isFocused: () => boolean
}
export type FocusDestination =
  | { readonly kind: 'target'; readonly token: FocusToken }
  | {
      readonly kind: 'match'
      readonly matches: (target: FocusTarget) => boolean
      readonly isValid?: () => boolean
    }

type Pending = {
  readonly token: FocusRequestToken
  readonly destination: FocusDestination
  readonly intent: FocusIntent
  readonly settle: (outcome: FocusTransitionOutcome) => void
  attempted: FocusToken | null
}
type Snapshot = {
  readonly scope: FocusScope
  readonly current: FocusTarget | null
  readonly lastCommandTarget: FocusTarget | null
  readonly requested: {
    readonly token: FocusRequestToken
    readonly target: FocusTarget | null
    readonly intent: FocusIntent
  } | null
  readonly result: {
    readonly token: FocusRequestToken
    readonly outcome: FocusTransitionOutcome
  } | null
}

export function createFocusRegistry(scope: FocusScope) {
  return new FocusRegistry(scope)
}

export class FocusRegistry {
  private readonly entries = new Map<FocusToken, FocusRegistration>()
  private readonly listeners = new Set<() => void>()
  private snapshot: Snapshot
  private lastActivated: FocusToken | null = null
  private overlayOwner: FocusToken | null = null
  private pending: Pending | null = null
  private disposed = false

  constructor(scope: FocusScope) {
    this.snapshot = { scope, current: null, lastCommandTarget: null, requested: null, result: null }
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.snapshot
  readonly capture = () => this.snapshot.current?.token ?? null

  resolve(token: FocusToken | null): FocusTarget | null {
    const entry = token ? this.entries.get(token) : null
    if (!entry || entry.available === false || !token || !sameScope(entry, this.snapshot.scope))
      return null
    return targetSnapshot(entry, token)
  }

  resolveTarget(options: {
    readonly compatible: (target: FocusTarget) => boolean
    readonly origin?: FocusToken | null
    readonly exact?: (target: FocusTarget) => boolean
    readonly eventPath?: readonly FocusToken[]
  }) {
    const targets = [...this.entries].flatMap(([token, entry]) =>
      entry.available !== false && sameScope(entry, this.snapshot.scope)
        ? [targetSnapshot(entry, token)]
        : [],
    )
    const event = options.eventPath
      ?.map((token) => this.resolve(token))
      .find((target) => target && options.compatible(target))
    return resolveFocusTarget({
      targets,
      compatible: options.compatible,
      origin: options.origin,
      owner: this.snapshot.current?.token,
      last: this.snapshot.lastCommandTarget?.token,
      exact: options.exact,
      event: event ? { status: 'resolved', registration: event } : undefined,
    })
  }

  activate(token: FocusToken) {
    const entry = this.entries.get(token)
    if (!entry?.isFocused()) return false
    const target = this.resolve(token)
    if (!target) {
      this.lastActivated = token
      return false
    }
    const overlay = this.activeOverlay()
    if (overlay && !target.capabilities.overlay) {
      this.invoke(overlay.token, 'focus')
      return false
    }
    this.lastActivated = token
    if (target.capabilities.overlay) {
      this.overlayOwner = token
      this.deferBackgroundRequest()
    }
    const lastCommandTarget = target.capabilities.overlay ? this.snapshot.lastCommandTarget : target
    if (this.snapshot.current?.token !== token)
      this.publish({ ...this.snapshot, current: target, lastCommandTarget })
    this.acknowledge(token, target)
    return true
  }

  request(destination: FocusDestination, intent: FocusIntent = 'focus'): FocusTransitionTicket {
    const token = createFocusRequestToken()
    const completion = Promise.withResolvers<FocusTransitionOutcome>()
    this.settle({ status: 'superseded', by: token })
    this.pending = { token, destination, intent, settle: completion.resolve, attempted: null }
    this.publish({ ...this.snapshot, requested: { token, target: null, intent } })
    this.tryPending()
    return { token, completion: completion.promise }
  }

  focus(token: FocusToken) {
    const ticket = this.request({ kind: 'target', token })
    if (this.pending?.token === ticket.token) return true
    return (
      this.snapshot.result?.token === ticket.token &&
      this.snapshot.result.outcome.status === 'acknowledged'
    )
  }

  restore(token: FocusToken | null) {
    if (token && this.focus(token)) return true
    for (const [fallback, entry] of this.entries) {
      if (entry.overlay || !sameScope(entry, this.snapshot.scope)) continue
      if (this.focus(fallback)) return true
    }
    return false
  }

  cycle(direction: 1 | -1) {
    const targets = [...this.entries].filter(
      ([, entry]) =>
        entry.available !== false && !entry.overlay && sameScope(entry, this.snapshot.scope),
    )
    if (!targets.length) return false
    const index = targets.findIndex(([token]) => token === this.snapshot.current?.token)
    const start = index < 0 && direction === -1 ? 0 : index
    const next = (start + direction + targets.length) % targets.length
    return this.focus(targets[next][0])
  }

  setScope(scope: FocusScope) {
    if (sameScope(this.snapshot.scope, scope)) return
    this.settle({ status: 'superseded', by: createFocusRequestToken() })
    const entry = this.lastActivated ? this.entries.get(this.lastActivated) : null
    const current =
      entry && this.lastActivated && entry.isFocused() && sameScope(entry, scope)
        ? targetSnapshot(entry, this.lastActivated)
        : null
    const lastCommandTarget = current?.capabilities.overlay ? null : current
    this.overlayOwner = current?.capabilities.overlay ? current.token : null
    this.publish({ ...this.snapshot, scope, current, lastCommandTarget })
  }

  register(input: FocusRegistration) {
    const token = createFocusTargetToken()
    this.entries.set(token, input)
    this.tryPending()
    return { token, unregister: () => this.unregister(token) }
  }

  refreshAvailability(token: FocusToken) {
    if (this.snapshot.current?.token === token && !this.resolve(token))
      this.publish({ ...this.snapshot, current: null })
    this.tryPending()
  }

  dispose() {
    this.disposed = true
    this.settle({ status: 'rejected', reason: 'unregistered' })
    this.entries.clear()
    this.listeners.clear()
  }

  private unregister(token: FocusToken) {
    this.entries.delete(token)
    if (this.lastActivated === token) this.lastActivated = null
    const current = this.snapshot.current?.token === token ? null : this.snapshot.current
    const lastCommandTarget =
      this.snapshot.lastCommandTarget?.token === token ? null : this.snapshot.lastCommandTarget
    this.publish({ ...this.snapshot, current, lastCommandTarget })
    if (this.pending?.attempted === token)
      this.settle({ status: 'rejected', reason: 'unregistered' })
    this.tryPending()
  }

  private tryPending() {
    const pending = this.pending
    if (!pending || pending.attempted) return
    if (this.disposed) {
      this.settle({ status: 'rejected', reason: 'unregistered' })
      return
    }
    if (pending.destination.kind === 'match' && pending.destination.isValid?.() === false) {
      this.settle({ status: 'rejected', reason: 'destination-invalid' })
      return
    }
    const targets = this.destinationTargets(pending.destination)
    if (targets.length > 1) {
      this.settle({ status: 'rejected', reason: 'destination-invalid' })
      return
    }
    const target = targets[0]
    if (!target) {
      if (pending.destination.kind === 'target')
        this.settle({ status: 'rejected', reason: 'unregistered' })
      return
    }
    if (this.activeOverlay() && !target.capabilities.overlay) return
    pending.attempted = target.token
    this.publish({
      ...this.snapshot,
      requested: { token: pending.token, target, intent: pending.intent },
    })
    if (this.pending?.token !== pending.token) return
    const accepted = this.invoke(target.token, pending.intent)
    if (this.pending?.token !== pending.token) return
    if (!accepted) {
      this.settle({ status: 'rejected', reason: 'refused' })
      return
    }
    this.activate(target.token)
  }

  private destinationTargets(destination: FocusDestination) {
    if (destination.kind === 'target') {
      const target = this.resolve(destination.token)
      return target ? [target] : []
    }
    return [...this.entries].flatMap(([token]) => {
      const target = this.resolve(token)
      return target && destination.matches(target) ? [target] : []
    })
  }

  private invoke(token: FocusToken, intent: FocusIntent) {
    try {
      return this.entries.get(token)?.focus(intent) === true
    } catch {
      return false
    }
  }

  private activeOverlay() {
    const target = this.resolve(this.overlayOwner)
    if (!target) this.overlayOwner = null
    return target
  }

  private deferBackgroundRequest() {
    const pending = this.pending
    if (!pending?.attempted || this.resolve(pending.attempted)?.capabilities.overlay) return
    pending.attempted = null
    this.publish({
      ...this.snapshot,
      requested: { token: pending.token, target: null, intent: pending.intent },
    })
  }

  private acknowledge(token: FocusToken, target: FocusTarget) {
    const pending = this.pending
    if (!pending || pending.attempted !== token) return
    const destination = pending.destination
    if (
      destination.kind === 'match' &&
      (destination.isValid?.() === false || !destination.matches(target))
    ) {
      this.settle({ status: 'rejected', reason: 'destination-invalid' })
      return
    }
    this.settle({ status: 'acknowledged', targetId: target.id })
  }

  private settle(outcome: FocusTransitionOutcome) {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.settle(outcome)
    this.publish({ ...this.snapshot, requested: null, result: { token: pending.token, outcome } })
  }

  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

function targetSnapshot(entry: FocusRegistration, token: FocusToken): FocusTarget {
  return {
    screen: entry.screen,
    environmentId: entry.environmentId,
    projectId: entry.projectId,
    id: { kind: 'tui-widget', key: entry.id },
    widgetId: entry.id,
    area: entry.area,
    capabilities: { textEntry: entry.textEntry, overlay: entry.overlay === true },
    token,
  }
}

export function sameScope(left: FocusScope, right: FocusScope) {
  return (
    left.screen === right.screen &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId
  )
}
