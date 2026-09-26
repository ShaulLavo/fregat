import {
  createFocusRequestToken,
  createFocusTargetToken,
  focusTargetIdsEqual,
  resolveFocusTarget,
} from '@workspace/client-core/commands/focus'
import type {
  FocusLayout,
  FocusTargetId,
  FocusIntent,
  FocusTransitionOutcome,
  FocusTransitionTicket,
  FocusRequestToken,
  FocusTargetToken,
} from '@workspace/client-core/commands/focus'
export { focusTargetIdsEqual } from '@workspace/client-core/commands/focus'
export type {
  FocusTargetId,
  FocusIntent,
  FocusTransitionOutcome,
  FocusTransitionTicket,
  FocusRequestToken,
  FocusTargetToken,
} from '@workspace/client-core/commands/focus'
import type { EditorKeymapContext } from '@singapore-editor/core/keymap'
import type { EditorCommandContext, EditorCommandId } from '@singapore-editor/core/editor'

import type { FocusArea } from '@workspace/client-core/commands/focus'
export type { FocusArea } from '@workspace/client-core/commands/focus'

type FocusEditorCapability = {
  readonly getInputElement?: () => HTMLElement | null
  readonly readKeymapContext?: () => EditorKeymapContext | null
  readonly dispatch: (command: EditorCommandId, context?: EditorCommandContext) => boolean
  readonly writable: boolean
}

type FocusTargetCapabilities = {
  readonly fixDiagnostic?: () => boolean
  readonly toggleCheckpointChange?: () => boolean
  readonly editor?: FocusEditorCapability
  readonly overlay?: boolean
}

export type FocusTargetSnapshot = {
  readonly area: FocusArea
  readonly capabilities: FocusTargetCapabilities
  readonly id: FocusTargetId
  readonly layout: FocusLayout | null
  readonly token: FocusTargetToken
}

export type ResolvedFocusTarget = FocusTargetSnapshot & {
  readonly element: HTMLElement
  readonly invoke: (intent: FocusIntent) => boolean
}

type FocusRequestedTransition = {
  readonly attemptedTarget: FocusTargetSnapshot | null
  readonly intent: FocusIntent
  readonly token: FocusRequestToken
}

export type FocusTransitionResult = {
  readonly outcome: FocusTransitionOutcome
  readonly token: FocusRequestToken
}

type FocusSnapshot = {
  readonly currentOwner: FocusTargetSnapshot | null
  readonly lastCommandTarget: FocusTargetSnapshot | null
  readonly requested: FocusRequestedTransition | null
  readonly result: FocusTransitionResult | null
  readonly revision: number
}

export type FocusTargetRegistrationInput = {
  readonly area: FocusArea
  readonly capabilities?: FocusTargetCapabilities
  readonly element: HTMLElement
  readonly id: FocusTargetId
  readonly onIntent: (intent: FocusIntent, element: HTMLElement) => boolean
}

export type FocusTargetRegistrationUpdate = Omit<FocusTargetRegistrationInput, 'element'>

export type FocusTargetRegistration = {
  readonly token: FocusTargetToken
  readonly unregister: () => void
  readonly update: (update: FocusTargetRegistrationUpdate) => void
}

export type FocusDestination =
  | {
      readonly kind: 'match'
      readonly isValid?: () => boolean
      readonly matches: (target: FocusTargetSnapshot) => boolean
    }
  | { readonly kind: 'target'; readonly token: FocusTargetToken }

export type FocusPathSource =
  | Event
  | { readonly composedPath: () => readonly EventTarget[] }
  | readonly EventTarget[]

export type FocusOriginSource = Element | FocusPathSource

export type ResolveFocusTargetOptions = {
  readonly compatible: (target: FocusTargetSnapshot) => boolean
  readonly exact?: (target: FocusTargetSnapshot) => boolean
  readonly origin?: FocusTargetToken | null
  readonly path?: FocusPathSource | null
}

type InternalRegistration = {
  area: FocusArea
  capabilities: FocusTargetCapabilities
  editorInput: HTMLElement | null
  readonly element: HTMLElement
  id: FocusTargetId
  onIntent: (intent: FocusIntent, element: HTMLElement) => boolean
  readonly token: FocusTargetToken
}

type PendingTransition = {
  attemptedToken: FocusTargetToken | null
  readonly destination: FocusDestination
  readonly intent: FocusIntent
  readonly resolve: (outcome: FocusTransitionOutcome) => void
  readonly token: FocusRequestToken
}

type ResolutionStage =
  | { readonly status: 'ambiguous' }
  | { readonly status: 'none' }
  | { readonly registration: InternalRegistration; readonly status: 'resolved' }

const EMPTY_CAPABILITIES: FocusTargetCapabilities = Object.freeze({})

const INITIAL_SNAPSHOT: FocusSnapshot = Object.freeze({
  currentOwner: null,
  lastCommandTarget: null,
  requested: null,
  result: null,
  revision: 0,
})

export function focusTargetById(id: FocusTargetId): FocusDestination {
  return {
    kind: 'match',
    matches: (target) => focusTargetIdsEqual(target.id, id),
  }
}

export function registeredFocusTarget(token: FocusTargetToken): FocusDestination {
  return { kind: 'target', token }
}

function freezeCapabilities(capabilities?: FocusTargetCapabilities): FocusTargetCapabilities {
  if (!capabilities) return EMPTY_CAPABILITIES

  const editor = capabilities.editor ? Object.freeze({ ...capabilities.editor }) : undefined
  return Object.freeze({
    fixDiagnostic: capabilities.fixDiagnostic,
    toggleCheckpointChange: capabilities.toggleCheckpointChange,
    ...(editor ? { editor } : {}),
    ...(capabilities.overlay === undefined ? {} : { overlay: capabilities.overlay }),
  })
}

function capabilitiesEqual(left: FocusTargetCapabilities, right: FocusTargetCapabilities): boolean {
  if (left.overlay !== right.overlay) return false
  if (Boolean(left.fixDiagnostic) !== Boolean(right.fixDiagnostic)) return false
  if (Boolean(left.toggleCheckpointChange) !== Boolean(right.toggleCheckpointChange)) return false

  return left.editor?.writable === right.editor?.writable
}

function snapshotFor(registration: InternalRegistration): FocusTargetSnapshot {
  return Object.freeze({
    area: registration.area,
    capabilities: registration.capabilities,
    id: registration.id,
    layout: focusLayoutForElement(registration.element),
    token: registration.token,
  })
}

function focusLayoutForElement(element: HTMLElement): FocusLayout | null {
  if (element.closest('[data-chat-mode]')) return 'chat'
  if (element.closest('[data-workbench]')) return 'workbench'

  return null
}

function requestedSnapshot(pending: PendingTransition | null, target: InternalRegistration | null) {
  if (!pending) return null

  return Object.freeze({
    attemptedTarget: target ? snapshotFor(target) : null,
    intent: pending.intent,
    token: pending.token,
  })
}

function isEventTargetPath(source: FocusPathSource): source is readonly EventTarget[] {
  return Array.isArray(source)
}

function pathFromSource(source: FocusPathSource): readonly EventTarget[] {
  if (isEventTargetPath(source)) return source

  const path = source.composedPath()
  if (path.length > 0) return path
  if ('target' in source && source.target) return [source.target]

  return []
}

function isElementSource(source: FocusOriginSource): source is Element {
  return 'nodeType' in source && source.nodeType === Node.ELEMENT_NODE
}

function sourceElement(source: FocusOriginSource): Element | null {
  if (isElementSource(source)) return source

  const path = pathFromSource(source)
  const first = path[0]
  if (!first || !('nodeType' in first)) return null

  return first.nodeType === Node.ELEMENT_NODE ? (first as Element) : null
}

function registrationContainsElement(registration: InternalRegistration, element: Element) {
  return composedElementContains(registration.element, element)
}

function composedElementContains(container: Element, element: Element) {
  let current: Node | null = element
  while (current) {
    if (current === container) return true

    current = composedParent(current)
  }

  return false
}

function composedParent(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot
  if (node.parentNode) return node.parentNode
  if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return null
  if (!('host' in node)) return null

  return node.host instanceof Element ? node.host : null
}

function deepestContaining(
  registrations: readonly InternalRegistration[],
  element: Element,
): ResolutionStage {
  const containing = registrations.filter((registration) =>
    registrationContainsElement(registration, element),
  )
  if (containing.length === 0) return { status: 'none' }

  const deepest = containing.filter((candidate) =>
    containing.every((other) => {
      if (candidate === other) return true
      if (candidate.element === other.element) return true

      return !composedElementContains(candidate.element, other.element)
    }),
  )
  if (deepest.length !== 1) return { status: 'ambiguous' }

  return { registration: deepest[0]!, status: 'resolved' }
}

export class FocusService {
  readonly getSnapshot = () => this.snapshot

  readonly handleFocusIn = (event: FocusEvent) => {
    const stage = this.resolvePath(pathFromSource(event), () => true)
    if (stage.status === 'resolved') {
      this.acceptActualOwner(stage.registration)
      this.tryPendingTransition()
      return
    }

    this.acceptActualOwner(null)
    this.tryPendingTransition()
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private currentOwner: FocusTargetSnapshot | null = null
  private lastCommandTarget: FocusTargetSnapshot | null = null
  private readonly listeners = new Set<() => void>()
  private pending: PendingTransition | null = null
  private readonly registrations = new Map<FocusTargetToken, InternalRegistration>()
  private result: FocusTransitionResult | null = null
  private snapshot = INITIAL_SNAPSHOT

  register(input: FocusTargetRegistrationInput): FocusTargetRegistration {
    const token = createFocusTargetToken()
    const registration: InternalRegistration = {
      ...input,
      capabilities: freezeCapabilities(input.capabilities),
      editorInput: input.capabilities?.editor?.getInputElement?.() ?? null,
      token,
    }
    this.registrations.set(token, registration)
    this.refreshOwnerFromActiveElement(input.element.ownerDocument)
    this.publish()
    this.tryPendingTransition()

    return Object.freeze({
      token,
      unregister: () => this.unregister(token),
      update: (update) => this.update(token, update),
    })
  }

  request(destination: FocusDestination, intent: FocusIntent = 'focus'): FocusTransitionTicket {
    const token = createFocusRequestToken()
    let settle!: (outcome: FocusTransitionOutcome) => void
    const completion = new Promise<FocusTransitionOutcome>((resolve) => {
      settle = resolve
    })

    this.supersedePending(token)
    this.pending = {
      attemptedToken: null,
      destination,
      intent,
      resolve: settle,
      token,
    }
    this.publish()
    this.tryPendingTransition()

    return Object.freeze({ completion, token })
  }

  resolveTarget(options: ResolveFocusTargetOptions): ResolvedFocusTarget | null {
    const registration = resolveFocusTarget({
      targets: [...this.registrations.values()],
      compatible: (target) => options.compatible(snapshotFor(target)),
      event: options.path
        ? this.resolvePath(pathFromSource(options.path), options.compatible)
        : undefined,
      origin: options.origin,
      owner: this.currentOwner?.token,
      last: this.lastCommandTarget?.token,
      exact: options.exact ? (target) => options.exact?.(snapshotFor(target)) === true : undefined,
    })
    return registration ? this.resolveRegistration(registration) : null
  }

  captureOrigin(source?: FocusOriginSource | null): FocusTargetToken | null {
    if (!source) return this.currentOwner?.token ?? null
    if (!isElementSource(source)) {
      const stage = this.resolvePath(pathFromSource(source), () => true)
      if (stage.status === 'resolved') return stage.registration.token
      if (stage.status === 'ambiguous') return null
    }

    const element = sourceElement(source)
    if (!element) return null

    const stage = deepestContaining([...this.registrations.values()], element)
    return stage.status === 'resolved' ? stage.registration.token : null
  }

  getTarget(token: FocusTargetToken): ResolvedFocusTarget | null {
    const registration = this.registrations.get(token)
    return registration ? this.resolveRegistration(registration) : null
  }

  isRegistered(token: FocusTargetToken): boolean {
    return this.registrations.has(token)
  }

  private acceptActualOwner(registration: InternalRegistration | null) {
    this.currentOwner = registration ? snapshotFor(registration) : null
    if (registration && !registration.capabilities.overlay) {
      this.lastCommandTarget = snapshotFor(registration)
    }
    this.publish()

    const pending = this.pending
    if (!pending?.attemptedToken || !registration) return
    if (pending.attemptedToken !== registration.token) return
    if (pending.destination.kind === 'match' && pending.destination.isValid?.() === false) {
      this.settlePending({ reason: 'destination-invalid', status: 'rejected' })
      return
    }
    if (!this.destinationMatches(pending, registration)) {
      this.settlePending({ reason: 'destination-invalid', status: 'rejected' })
      return
    }

    this.settlePending({ status: 'acknowledged', targetId: registration.id })
  }

  private acknowledgeActiveAttempt(pending: PendingTransition, registration: InternalRegistration) {
    if (this.pending?.token !== pending.token) return

    const activeElement = registration.element.ownerDocument.activeElement
    if (!activeElement) return

    const stage = deepestContaining([...this.registrations.values()], activeElement)
    if (stage.status !== 'resolved') return
    if (stage.registration.token !== registration.token) return

    this.acceptActualOwner(registration)
  }

  private destinationMatches(pending: PendingTransition, registration: InternalRegistration) {
    if (pending.destination.kind === 'target') {
      return pending.destination.token === registration.token
    }

    return pending.destination.matches(snapshotFor(registration))
  }

  private matchingDestination(pending: PendingTransition): ResolutionStage {
    const destination = pending.destination
    if (destination.kind === 'target') {
      const registration = this.registrations.get(destination.token)
      if (!registration) return { status: 'none' }

      return { registration, status: 'resolved' }
    }

    return this.resolveMatches((target) => destination.matches(target))
  }

  private publish() {
    const attempted = this.pending?.attemptedToken
      ? (this.registrations.get(this.pending.attemptedToken) ?? null)
      : null
    this.snapshot = Object.freeze({
      currentOwner: this.currentOwner,
      lastCommandTarget: this.lastCommandTarget,
      requested: requestedSnapshot(this.pending, attempted),
      result: this.result,
      revision: this.snapshot.revision + 1,
    })
    this.listeners.forEach((listener) => listener())
  }

  private refreshOwnerFromActiveElement(ownerDocument: Document) {
    const activeElement = ownerDocument.activeElement
    if (!activeElement) return

    const stage = deepestContaining([...this.registrations.values()], activeElement)
    if (stage.status === 'resolved') {
      this.currentOwner = snapshotFor(stage.registration)
      if (!stage.registration.capabilities.overlay) {
        this.lastCommandTarget = snapshotFor(stage.registration)
      }
      return
    }

    this.currentOwner = null
  }

  private resolveMatches(
    compatible: (target: FocusTargetSnapshot) => boolean,
    exact: (target: FocusTargetSnapshot) => boolean = () => true,
  ): ResolutionStage {
    const matches = [...this.registrations.values()].filter((registration) => {
      const target = snapshotFor(registration)
      return compatible(target) && exact(target)
    })
    if (matches.length === 0) return { status: 'none' }
    if (matches.length > 1) return { status: 'ambiguous' }

    return { registration: matches[0]!, status: 'resolved' }
  }

  private resolvePath(
    path: readonly EventTarget[],
    compatible: (target: FocusTargetSnapshot) => boolean,
  ): ResolutionStage {
    for (const entry of path) {
      const matches = [...this.registrations.values()].filter((registration) => {
        if (registration.element !== entry) return false

        return compatible(snapshotFor(registration))
      })
      if (matches.length > 1) return { status: 'ambiguous' }
      if (matches.length === 1) return { registration: matches[0]!, status: 'resolved' }
    }

    const firstElement = path.find(
      (entry): entry is Element => 'nodeType' in entry && entry.nodeType === Node.ELEMENT_NODE,
    )
    if (!firstElement) return { status: 'none' }

    const registrations = [...this.registrations.values()].filter((registration) =>
      compatible(snapshotFor(registration)),
    )
    return deepestContaining(registrations, firstElement)
  }

  private resolveRegistration(registration: InternalRegistration): ResolvedFocusTarget {
    return Object.freeze({
      ...snapshotFor(registration),
      element: registration.element,
      invoke: (intent) => registration.onIntent(intent, registration.element),
    })
  }

  private settlePending(outcome: FocusTransitionOutcome) {
    const pending = this.pending
    if (!pending) return

    this.pending = null
    this.result = Object.freeze({ outcome, token: pending.token })
    pending.resolve(outcome)
    this.publish()
  }

  private supersedePending(by: FocusRequestToken) {
    const pending = this.pending
    if (!pending) return

    this.pending = null
    const outcome: FocusTransitionOutcome = { by, status: 'superseded' }
    this.result = Object.freeze({ outcome, token: pending.token })
    pending.resolve(outcome)
  }

  private tryPendingTransition() {
    const pending = this.pending
    if (!pending || pending.attemptedToken) return
    if (pending.destination.kind === 'match' && pending.destination.isValid?.() === false) {
      this.settlePending({ reason: 'destination-invalid', status: 'rejected' })
      return
    }

    const stage = this.matchingDestination(pending)
    if (stage.status === 'ambiguous') {
      this.settlePending({ reason: 'destination-invalid', status: 'rejected' })
      return
    }
    if (stage.status === 'none') {
      if (pending.destination.kind === 'target') {
        this.settlePending({ reason: 'unregistered', status: 'rejected' })
      }
      return
    }

    pending.attemptedToken = stage.registration.token
    this.publish()
    let accepted = false
    try {
      accepted = stage.registration.onIntent(pending.intent, stage.registration.element)
    } catch {
      accepted = false
    }
    if (this.pending?.token !== pending.token) return
    if (!accepted) {
      this.settlePending({ reason: 'refused', status: 'rejected' })
      return
    }

    this.acknowledgeActiveAttempt(pending, stage.registration)
  }

  private unregister(token: FocusTargetToken) {
    const registration = this.registrations.get(token)
    if (!registration) return

    this.registrations.delete(token)
    const attempted = this.pending?.attemptedToken === token
    if (this.currentOwner?.token === token) {
      this.refreshOwnerFromActiveElement(registration.element.ownerDocument)
    }
    if (this.lastCommandTarget?.token === token) this.lastCommandTarget = null
    if (attempted) {
      this.settlePending({ reason: 'unregistered', status: 'rejected' })
      return
    }

    this.publish()
    this.tryPendingTransition()
  }

  private update(token: FocusTargetToken, update: FocusTargetRegistrationUpdate) {
    const registration = this.registrations.get(token)
    if (!registration) return

    const capabilities = freezeCapabilities(update.capabilities)
    const editorInput = capabilities.editor?.getInputElement?.() ?? null
    const publicChanged =
      registration.area !== update.area ||
      !focusTargetIdsEqual(registration.id, update.id) ||
      registration.editorInput !== editorInput ||
      !capabilitiesEqual(registration.capabilities, capabilities)
    registration.area = update.area
    registration.capabilities = capabilities
    registration.editorInput = editorInput
    registration.id = update.id
    registration.onIntent = update.onIntent

    const pending = this.pending
    if (pending?.attemptedToken === token && !this.destinationMatches(pending, registration)) {
      this.settlePending({ reason: 'destination-invalid', status: 'rejected' })
      return
    }
    if (this.currentOwner?.token === token) this.currentOwner = snapshotFor(registration)
    if (this.lastCommandTarget?.token === token) this.lastCommandTarget = snapshotFor(registration)
    if (publicChanged) this.publish()
    this.tryPendingTransition()
  }
}
