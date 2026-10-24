import { createDispatcher } from '../dispatch/dispatcher'
import { detectPlatform } from '../platform'
import { isInputElement } from '../_event-target'
import { attachKeyListeners, browserKeyEffects, replayTextInput } from './browser-listeners'
import type { Dispatcher, DispatcherOptions, FocusNode } from '../dispatch/dispatcher'
import type { KeyResetReason } from './browser-listeners'

export type BrowserDispatcherOptions = Omit<DispatcherOptions<KeyboardEvent>, 'effects'> & {
  /** Where idle keys are heard; defaults to the global document. */
  readonly root?: HTMLElement | Document
  /** Hears idle keys before descendant input handlers; defaults to bubbling. */
  readonly capture?: boolean
  /** Runs before each key event is offered, for hosts that update the keymap lazily. */
  readonly beforeKey?: (event: KeyboardEvent) => void
}
export type BrowserKeyObserver = {
  /** Runs once before an offered event is matched or consumed, including claimed releases. */
  readonly beforeKey: (event: KeyboardEvent) => void
  /** Clears host bookkeeping when the dispatcher drops held-key ownership. */
  readonly reset?: (reason: KeyResetReason) => void
}
type ElementAttachment = { readonly node: FocusNode<KeyboardEvent>; readonly depth: number }
type ObserverRegistration = { readonly observer: BrowserKeyObserver }
export type BrowserDispatcher = Dispatcher<KeyboardEvent> & {
  /**
   * Ties a node to an element: a key focuses the closest attached element's deepest node.
   * Later attachments win equal-depth ties. Returns the tie's removal.
   */
  readonly attachElement: (node: FocusNode<KeyboardEvent>, element: Element) => () => void
  /** Finds the closest attached element's node for a captured command origin. */
  readonly nodeForElement: (element: Element) => FocusNode<KeyboardEvent> | null
  /** Offers an event before DOM dispatch reaches the root, for hosts that forward keys (terminals). */
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  /** Observes the existing key pipeline; returns the observer's removal. */
  readonly observeKeys: (observer: BrowserKeyObserver) => () => void
}

/** A dispatcher whose focus path follows DOM containment of attached elements. */
export function createBrowserDispatcher(options: BrowserDispatcherOptions = {}): BrowserDispatcher {
  const root = options.root ?? globalThis.document
  const platform = options.platform ?? detectPlatform()
  const nodes = new Map<Element, Set<ElementAttachment>>()
  const observers = new Set<ObserverRegistration>()
  let disposed = false
  const doc = 'defaultView' in root ? root : root.ownerDocument
  const dispatcher = createDispatcher<KeyboardEvent>({
    acceptsTextInput: (event) => isInputElement(event.target),
    replay: replayTextInput,
    currentFocus: () => doc.activeElement,
    ...options,
    platform,
    effects: browserKeyEffects,
    onCaptureChange: () => {
      listeners.syncCapture()
      options.onCaptureChange?.()
    },
  })
  const listeners = attachKeyListeners(
    root,
    platform,
    () => dispatcher,
    focusFromEvent,
    reset,
    options.capture,
  )

  function focusFromEvent(event: KeyboardEvent) {
    options.beforeKey?.(event)
    notifyObservers((observer) => observer.beforeKey(event))
    if (!nodes.size || event.type !== 'keydown') return
    for (const target of event.composedPath()) {
      const node = target instanceof Element ? attachedNode(target) : undefined
      if (node) return dispatcher.focus(node)
    }
    dispatcher.focus(null)
  }
  function attachElement(node: FocusNode<KeyboardEvent>, element: Element) {
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) depth += 1
    const attachment = { node, depth }
    const attached = nodes.get(element) ?? new Set<ElementAttachment>()
    nodes.set(element, attached)
    attached.add(attachment)
    return () => {
      attached.delete(attachment)
      if (!attached.size && nodes.get(element) === attached) nodes.delete(element)
    }
  }
  function attachedNode(element: Element) {
    let selected: ElementAttachment | undefined
    for (const attachment of nodes.get(element) ?? []) {
      if (!dispatcher.hasNode(attachment.node)) continue
      if (!selected || attachment.depth >= selected.depth) selected = attachment
    }
    return selected?.node
  }
  function nodeForElement(element: Element) {
    if (disposed) return null
    for (let current: Element | null = element; current; current = parentElement(current)) {
      const node = attachedNode(current)
      if (node) return node
    }
    return null
  }
  function parentElement(element: Element) {
    if (element.parentElement) return element.parentElement
    const root = element.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
  }
  function observeKeys(observer: BrowserKeyObserver) {
    if (disposed) return () => {}
    const registration = { observer }
    observers.add(registration)
    return () => void observers.delete(registration)
  }
  function notifyObservers(notify: (observer: BrowserKeyObserver) => void) {
    for (const registration of Array.from(observers)) {
      if (observers.has(registration)) notify(registration.observer)
    }
  }
  function reset(reason: KeyResetReason) {
    notifyObservers((observer) => observer.reset?.(reason))
  }
  return {
    ...dispatcher,
    attachElement,
    nodeForElement,
    claimKeybinding: listeners.claim,
    observeKeys,
    releaseAll: () => {
      dispatcher.releaseAll()
      reset('releaseAll')
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      dispatcher.dispose()
      listeners.dispose()
      reset('dispose')
      observers.clear()
      nodes.clear()
    },
  }
}
