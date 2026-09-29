import { createDispatcher } from '../dispatch/dispatcher'
import { detectPlatform } from '../platform'
import { isInputElement } from '../_event-target'
import { attachKeyListeners, browserKeyEffects } from './browser-listeners'
import type { Dispatcher, DispatcherOptions, FocusNode } from '../dispatch/dispatcher'

export type BrowserDispatcherOptions = Omit<DispatcherOptions<KeyboardEvent>, 'effects'> & {
  /** Where idle keys are heard; defaults to the global document. */
  readonly root?: HTMLElement | Document
}
export type BrowserDispatcher = Dispatcher<KeyboardEvent> & {
  /**
   * Ties a node to an element: a key from inside the element focuses the deepest such node
   * first. Returns the tie's removal.
   */
  readonly attachElement: (node: FocusNode<KeyboardEvent>, element: Element) => () => void
  /** Offers an event before DOM dispatch reaches the root, for hosts that forward keys (terminals). */
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
}

/** A dispatcher whose focus path follows DOM containment of attached elements. */
export function createBrowserDispatcher(options: BrowserDispatcherOptions = {}): BrowserDispatcher {
  const root = options.root ?? document
  const platform = options.platform ?? detectPlatform()
  const nodes = new Map<Element, FocusNode<KeyboardEvent>>()
  const dispatcher = createDispatcher<KeyboardEvent>({
    acceptsTextInput: (event) => isInputElement(event.target),
    ...options,
    platform,
    effects: browserKeyEffects,
    onCaptureChange: () => {
      listeners.syncCapture()
      options.onCaptureChange?.()
    },
  })
  const listeners = attachKeyListeners(root, platform, () => dispatcher, focusFromEvent)

  function focusFromEvent(event: KeyboardEvent) {
    if (!nodes.size || event.type !== 'keydown') return
    for (const target of event.composedPath()) {
      const node = target instanceof Element ? nodes.get(target) : undefined
      if (node) return dispatcher.focus(node)
    }
    dispatcher.focus(null)
  }
  function attachElement(node: FocusNode<KeyboardEvent>, element: Element) {
    nodes.set(element, node)
    return () => {
      if (nodes.get(element) === node) nodes.delete(element)
    }
  }
  return {
    ...dispatcher,
    attachElement,
    claimKeybinding: listeners.claim,
    dispose: () => {
      dispatcher.dispose()
      listeners.dispose()
    },
  }
}
