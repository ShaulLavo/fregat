import { playFeedback } from './feedback-layer'

function enabledControl(event: Event): HTMLElement | null {
  const target = event.composedPath().find((node) => node instanceof HTMLElement)
  if (!(target instanceof HTMLElement)) return null
  const control = target.closest<HTMLElement>('.pressable, [data-press-depth], [data-feedback]')
  if (!control || control.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null
  return control
}

export function installFeedbackListeners(document: Document) {
  let pressed:
    | { element: HTMLElement; input: 'keyboard' }
    | { element: HTMLElement; input: 'pointer'; pointerId: number }
    | null = null
  const release = () => {
    pressed?.element.removeAttribute('data-pressing')
    pressed = null
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    const control = enabledControl(event)
    if (!control || control.matches('input, textarea, [contenteditable="true"]')) return
    release()
    pressed = { element: control, input: 'keyboard' }
    control.setAttribute('data-pressing', '')
  }
  const keyup = (event: KeyboardEvent) => {
    if (pressed?.input === 'keyboard' && (event.key === ' ' || event.key === 'Enter')) release()
  }
  const pointerdown = (event: PointerEvent) => {
    release()
    if (event.button !== 0 || event.defaultPrevented) return
    const control = enabledControl(event)
    if (control?.matches('.pressable, [data-press-depth]')) {
      pressed = { element: control, input: 'pointer', pointerId: event.pointerId }
      control.setAttribute('data-pressing', '')
    }
    if (control?.dataset.feedback !== 'tap') return
    playFeedback('tap', 'controls')
  }
  const pointerup = (event: PointerEvent) => {
    if (pressed?.input === 'pointer' && pressed.pointerId === event.pointerId) release()
  }
  const focusout = () => {
    if (pressed?.input === 'keyboard') release()
  }
  document.addEventListener('keydown', keydown)
  document.addEventListener('keyup', keyup)
  document.addEventListener('pointerdown', pointerdown)
  document.addEventListener('pointerup', pointerup, true)
  document.addEventListener('pointercancel', pointerup, true)
  document.addEventListener('focusout', focusout)
  document.defaultView?.addEventListener('blur', release)
  return () => {
    release()
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
    document.removeEventListener('pointerdown', pointerdown)
    document.removeEventListener('pointerup', pointerup, true)
    document.removeEventListener('pointercancel', pointerup, true)
    document.removeEventListener('focusout', focusout)
    document.defaultView?.removeEventListener('blur', release)
  }
}
