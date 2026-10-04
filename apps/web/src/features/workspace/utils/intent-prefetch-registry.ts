import { ForesightManager, type HitSlop } from 'js.foresight'

type IntentReason = 'trajectory' | 'hover' | 'focus'
type OnIntent<TIntent> = (intent: TIntent, reason: IntentReason) => void | (() => void)
type IntentPrefetchRow<TIntent> = {
  intent: TIntent
  key: string
  meta: Record<string, unknown>
  name: string
}
export type IntentPrefetchTarget<TIntent> = {
  readonly element: HTMLElement
  readonly row: IntentPrefetchRow<TIntent>
}
export type IntentPrefetchRegistryConfig = {
  hitSlop?: HitSlop
  reactivateAfter: number
}
export type IntentPrefetchRegistry<TIntent> = {
  clear(): void
  sync(targets: Iterable<IntentPrefetchTarget<TIntent>>, onIntent: OnIntent<TIntent>): void
}
type Registration<TIntent> = {
  row: IntentPrefetchRow<TIntent>
  onIntent: OnIntent<TIntent>
  readonly releases: Map<IntentReason, () => void>
  detach(): void
}

export function createIntentPrefetchRegistry<TIntent>({
  hitSlop,
  reactivateAfter,
}: IntentPrefetchRegistryConfig): IntentPrefetchRegistry<TIntent> {
  const registrations = new Map<HTMLElement, Registration<TIntent>>()

  function sync(targets: Iterable<IntentPrefetchTarget<TIntent>>, onIntent: OnIntent<TIntent>) {
    const current = new Map<HTMLElement, IntentPrefetchRow<TIntent>>()
    for (const { element, row } of targets) current.set(element, row)
    for (const element of registrations.keys()) {
      if (!current.has(element)) unregister(element)
    }
    for (const [element, row] of current) register(element, row, onIntent)
  }

  function register(
    element: HTMLElement,
    row: IntentPrefetchRow<TIntent>,
    onIntent: OnIntent<TIntent>,
  ) {
    const previous = registrations.get(element)
    if (previous?.row.key === row.key && previous.row.intent === row.intent) {
      previous.row = row
      previous.onIntent = onIntent
      return
    }
    if (previous) unregister(element)
    const releases = new Map<IntentReason, () => void>()
    const registration: Registration<TIntent> = { row, onIntent, releases, detach: () => {} }
    const begin = (reason: IntentReason) => {
      const next = registration.onIntent(registration.row.intent, reason)
      const old = releases.get(reason)
      if (next) releases.set(reason, next)
      else releases.delete(reason)
      old?.()
    }
    const end = (reason: IntentReason) => {
      const old = releases.get(reason)
      releases.delete(reason)
      old?.()
    }
    const enter = () => begin('hover')
    const leave = () => {
      end('hover')
      end('trajectory')
    }
    const focus = () => begin('focus')
    const blur = () => end('focus')
    element.addEventListener('pointerenter', enter)
    element.addEventListener('pointerleave', leave)
    element.addEventListener('focus', focus)
    element.addEventListener('blur', blur)
    registration.detach = () => {
      element.removeEventListener('pointerenter', enter)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('focus', focus)
      element.removeEventListener('blur', blur)
      const captured = [...releases.values()]
      releases.clear()
      for (const release of captured) release()
    }
    registrations.set(element, registration)
    ForesightManager.instance.register({
      callback: () => begin('trajectory'),
      element,
      hitSlop,
      meta: row.meta,
      name: row.name,
      reactivateAfter,
    })
  }

  function unregister(element: HTMLElement) {
    const old = registrations.get(element)
    registrations.delete(element)
    if (ForesightManager.isInitiated) ForesightManager.instance.unregister(element)
    old?.detach()
  }
  function clear() {
    for (const element of registrations.keys()) unregister(element)
  }
  return { clear, sync }
}
