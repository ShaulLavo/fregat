import {
  beginControlGesture,
  cancelControlGesture,
  feedbackControl,
  finishControlGesture,
  playClickFeedback,
  releaseControlGesture,
} from './feedback-layer'

function enabledControl(event: Event): HTMLElement | null {
  const control = feedbackControl(event)
  if (
    !control ||
    control.matches(
      ':disabled, [aria-disabled="true"], [data-disabled]:not([data-disabled="false"])',
    )
  )
    return null
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
    if (control?.matches('.pressable, [data-press-depth], [data-row-press]')) {
      pressed = { element: control, input: 'pointer', pointerId: event.pointerId }
      control.setAttribute('data-pressing', '')
    }
  }
  const pointerup = (event: PointerEvent) => {
    if (pressed?.input === 'pointer' && pressed.pointerId === event.pointerId) release()
  }
  const pointercancel = (event: PointerEvent) => {
    pointerup(event)
    cancelControlGesture(event.pointerId)
  }
  const dragstart = () => {
    release()
    cancelControlGesture()
  }
  const focusout = () => {
    if (pressed?.input === 'keyboard') release()
  }
  document.addEventListener('keydown', keydown)
  document.addEventListener('keyup', keyup)
  document.addEventListener('pointerdown', pointerdown)
  document.addEventListener('pointerdown', beginControlGesture, true)
  document.addEventListener('mouseup', releaseControlGesture, true)
  document.addEventListener('mouseup', finishControlGesture)
  document.addEventListener('click', playClickFeedback)
  document.addEventListener('pointerup', pointerup, true)
  document.addEventListener('pointercancel', pointercancel, true)
  document.addEventListener('focusout', focusout)
  document.addEventListener('dragstart', dragstart, true)
  document.defaultView?.addEventListener('blur', release)
  return () => {
    release()
    cancelControlGesture()
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
    document.removeEventListener('pointerdown', pointerdown)
    document.removeEventListener('pointerdown', beginControlGesture, true)
    document.removeEventListener('mouseup', releaseControlGesture, true)
    document.removeEventListener('mouseup', finishControlGesture)
    document.removeEventListener('click', playClickFeedback)
    document.removeEventListener('pointerup', pointerup, true)
    document.removeEventListener('pointercancel', pointercancel, true)
    document.removeEventListener('focusout', focusout)
    document.removeEventListener('dragstart', dragstart, true)
    document.defaultView?.removeEventListener('blur', release)
  }
}
