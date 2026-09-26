import { playFeedback } from './feedback-layer'

function enabledControl(event: Event): HTMLElement | null {
  const target = event.composedPath().find((node) => node instanceof HTMLElement)
  if (!(target instanceof HTMLElement)) return null
  const control = target.closest<HTMLElement>('.pressable, [data-press-depth], [data-feedback]')
  if (!control || control.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null
  return control
}

export function installFeedbackListeners(document: Document) {
  let pressed: HTMLElement | null = null
  const release = () => {
    pressed?.removeAttribute('data-pressing')
    pressed = null
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    const control = enabledControl(event)
    if (!control || control.matches('input, textarea, [contenteditable="true"]')) return
    release()
    pressed = control
    pressed.setAttribute('data-pressing', '')
  }
  const keyup = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') release()
  }
  const pointerdown = (event: PointerEvent) => {
    release()
    if (event.button !== 0 || event.defaultPrevented) return
    const control = enabledControl(event)
    if (control?.dataset.feedback !== 'tap') return
    playFeedback('tap', 'controls')
  }
  document.addEventListener('keydown', keydown)
  document.addEventListener('keyup', keyup)
  document.addEventListener('pointerdown', pointerdown)
  document.addEventListener('focusout', release)
  document.defaultView?.addEventListener('blur', release)
  return () => {
    release()
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
    document.removeEventListener('pointerdown', pointerdown)
    document.removeEventListener('focusout', release)
    document.defaultView?.removeEventListener('blur', release)
  }
}
