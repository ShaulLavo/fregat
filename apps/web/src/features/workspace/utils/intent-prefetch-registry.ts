import { ForesightManager, type HitSlop } from 'js.foresight'

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
  clear: () => void
  sync: (
    targets: Iterable<IntentPrefetchTarget<TIntent>>,
    onIntent: (intent: TIntent) => void,
  ) => void
}

export function createIntentPrefetchRegistry<TIntent>({
  hitSlop,
  reactivateAfter,
}: IntentPrefetchRegistryConfig): IntentPrefetchRegistry<TIntent> {
  const registrations = new Map<HTMLElement, string>()

  function sync(
    targets: Iterable<IntentPrefetchTarget<TIntent>>,
    onIntent: (intent: TIntent) => void,
  ) {
    const current = new Map<HTMLElement, IntentPrefetchRow<TIntent>>()
    for (const { element, row } of targets) current.set(element, row)

    for (const element of registrations.keys()) {
      if (current.has(element)) continue

      unregister(element)
    }

    for (const [element, row] of current) {
      register(element, row, onIntent)
    }
  }

  function register(
    element: HTMLElement,
    row: IntentPrefetchRow<TIntent>,
    onIntent: (intent: TIntent) => void,
  ) {
    const currentKey = registrations.get(element)
    if (currentKey === row.key) return
    if (currentKey) unregister(element)

    ForesightManager.instance.register({
      callback: () => onIntent(row.intent),
      element,
      hitSlop,
      meta: row.meta,
      name: row.name,
      reactivateAfter,
    })
    registrations.set(element, row.key)
  }

  function unregister(element: HTMLElement) {
    registrations.delete(element)
    if (!ForesightManager.isInitiated) return

    ForesightManager.instance.unregister(element)
  }

  function clear() {
    for (const element of registrations.keys()) {
      unregister(element)
    }
  }

  return { clear, sync }
}
