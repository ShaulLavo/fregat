import { createStore } from 'zustand/vanilla'
import { readCachedEnvironmentBindings } from '@/lib/environments/state/binding-cache'
import { createBootRuntime } from '@/state/bootstrap-runtime'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { createNavigation } from '@/state/navigation'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { toConnectionError } from '@/lib/client-error-taxonomy'

type BootstrapState = {
  readonly application: ApplicationRuntime | null
  readonly error: string | null
}

// Prepared before createRoot. React's effect replay must never destroy retained documents.
export function createBootstrap(navigation: ReturnType<typeof createNavigation>) {
  const store = createStore<BootstrapState>(() => ({
    application: prepareCachedRuntime(navigation),
    error: null,
  }))
  let abort: AbortController | null = null
  let detach: (() => void) | undefined
  let disposed = false
  let generation = 0

  function start() {
    if (abort || disposed) return
    generation += 1
    const controller = new AbortController()
    abort = controller
    const prepared = store.getState().application
    if (prepared) detach = navigation.attach(prepared)
    useEnvironmentsStore.getState().setPhase(primaryServerOrigin(), 'connecting')
    void readEnvironmentDescriptor(
      primaryServerOrigin(),
      AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    )
      .then((descriptor) => {
        if (controller.signal.aborted) return
        const application =
          store.getState().application ?? createBootRuntime(descriptor, navigation.initial)
        if (!detach) detach = navigation.attach(application)
        store.setState({ application, error: null })
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        const failure = toConnectionError(cause, 'Cannot connect to the local machine.')
        const phase = useEnvironmentsStore.getState().entries[primaryServerOrigin()]?.phase
        if (phase === 'identity-drift' || phase === 'blocked') {
          detach?.()
          detach = undefined
          store.getState().application?.dispose()
          store.setState({ application: null, error: failure.message })
          return
        }
        useEnvironmentsStore.getState().setPhase(primaryServerOrigin(), 'offline', failure)
        if (!store.getState().application) store.setState({ error: failure.message })
      })
  }

  function stop() {
    abort?.abort()
    abort = null
    detach?.()
    detach = undefined
    const stopped = ++generation
    queueMicrotask(() => {
      if (generation === stopped) dispose()
    })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    abort?.abort()
    detach?.()
    store.getState().application?.dispose()
  }

  return {
    ...store,
    start,
    stop,
    dispose,
    retry() {
      abort?.abort()
      abort = null
      detach?.()
      detach = undefined
      store.setState({ error: null })
      start()
    },
  }
}

function prepareCachedRuntime(navigation: ReturnType<typeof createNavigation>) {
  const cached = readCachedEnvironmentBindings(['local']).find(
    (binding) => binding.origin === primaryServerOrigin(),
  )
  if (!cached) return null
  try {
    return createBootRuntime(cached.descriptor, navigation.initial, true)
  } catch {
    return null
  }
}
