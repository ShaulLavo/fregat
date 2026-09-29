import { keyInputFromKeyboardEvent } from './browser'
import { isInputElement } from '../_event-target'
import type { KeyInput } from '../key-input'
import type { ChordOutcome, KeymapPlatform } from '../chords/types'
import type { KeyEffects } from '../chords/runtime'

/** What the listeners drive: a chord runtime, or a dispatcher wrapping one. */
export type KeyListenerTarget = {
  readonly handleKey: (input: KeyInput, event: KeyboardEvent, inScope: boolean) => boolean
  readonly capturesKey: (input: KeyInput) => boolean
  readonly wantsCapture: () => boolean
  readonly releaseAll: () => void
  readonly cancel: (outcome: ChordOutcome) => void
}
export type KeyListeners = {
  /** Offers an event; idempotent per event, so a host may forward it before DOM dispatch. */
  readonly claim: (event: KeyboardEvent) => boolean
  /** Adds or removes the capture listener after the target's pending state changed. */
  readonly syncCapture: () => void
  readonly dispose: () => void
}

export const browserKeyEffects: KeyEffects<KeyboardEvent> = {
  preventDefault: (event) => event.preventDefault(),
  stopPropagation: (event) => event.stopPropagation(),
  swallow: (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  },
}

/** Types a replayed printable key into the text field it was pressed in. */
export function replayTextInput(input: KeyInput, event: KeyboardEvent): void {
  const text = event.key
  if (input.modifiers.ctrl || input.modifiers.meta || [...text].length !== 1) return
  const field = event.target
  if (!(field instanceof HTMLElement) || !isInputElement(field)) return
  const document = field.ownerDocument
  // execCommand keeps the field's undo history; happy-dom and old engines lack it.
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text))
    return
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return
  const end = field.selectionEnd ?? field.value.length
  field.setRangeText(text, field.selectionStart ?? end, end, 'end')
  field.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
  )
}

/**
 * Listens on `root` for idle keys and on its document while a chord is pending, and cancels the
 * pending chord on blur, hidden tab, pointer down and focus leaving an element root.
 */
export function attachKeyListeners(
  root: HTMLElement | Document,
  platform: KeymapPlatform,
  target: () => KeyListenerTarget,
  beforeKey?: (event: KeyboardEvent) => void,
): KeyListeners {
  const document = 'defaultView' in root ? root : root.ownerDocument
  const window = document.defaultView
  const processed = new WeakMap<KeyboardEvent, boolean>()
  let disposed = false

  function syncCapture() {
    if (!disposed && target().wantsCapture()) document.addEventListener('keydown', onCapture, true)
    else document.removeEventListener('keydown', onCapture, true)
  }
  function claim(event: KeyboardEvent): boolean {
    if (disposed) return false
    const prior = processed.get(event)
    if (prior !== undefined) return prior
    beforeKey?.(event)
    const input = keyInputFromKeyboardEvent(event, platform)
    const owned = target().handleKey(input, event, input.type === 'keyup' || inRoot(event))
    processed.set(event, owned)
    return owned
  }
  function inRoot(event: Event) {
    if (root === document && event.target === null) return true
    return event.composedPath().includes(root)
  }
  function onCapture(event: KeyboardEvent) {
    if (target().capturesKey(keyInputFromKeyboardEvent(event, platform))) claim(event)
  }
  function onKeyDown(event: Event) {
    if (event.defaultPrevented || !('code' in event)) return
    if (!(event instanceof KeyboardEvent)) return
    claim(event)
  }
  function onKeyUp(event: KeyboardEvent) {
    claim(event)
  }
  function onBlur() {
    target().releaseAll()
    target().cancel('blur')
  }
  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return
    target().releaseAll()
    target().cancel('hidden')
  }
  function onPointerDown() {
    target().cancel('pointer')
  }
  function onFocusOut(event: Event) {
    if (root === document) return
    if (!(event instanceof FocusEvent)) return
    const next = event.relatedTarget
    if (next instanceof Node && root.contains(next)) return
    target().cancel('superseded')
  }
  function dispose() {
    if (disposed) return
    disposed = true
    syncCapture()
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('keyup', onKeyUp, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('pointerdown', onPointerDown, true)
    window?.removeEventListener('blur', onBlur)
  }
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('focusout', onFocusOut)
  document.addEventListener('keyup', onKeyUp, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('pointerdown', onPointerDown, true)
  window?.addEventListener('blur', onBlur)
  return { claim, syncCapture, dispose }
}
