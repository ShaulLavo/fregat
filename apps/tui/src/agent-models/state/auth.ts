import { createObservableStore } from '@/host/state/observable-store'
import * as v from 'valibot'
import {
  providerAuthResultSchema,
  providerLoginAttemptSchema,
  type ProviderAuthResult,
  type ProviderInstanceId,
  type ProviderLoginAttempt,
  type ProviderSignInMethod,
} from '@workspace/contracts'
import type { Client } from '@workspace/client-core/transport/client'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import { connectionFailure } from '@/connection/utils/failure'

type State = {
  readonly busy: boolean
  readonly auth: ProviderAuthResult | null
  readonly attempt: ProviderLoginAttempt | null
  readonly error: string | null
}

export function createProviderAuth(
  client: Client,
  providerInstanceId: ProviderInstanceId,
  record?: (event: Record<string, unknown>) => void,
) {
  const api = client.providers({ providerInstanceId }).auth
  const store = createObservableStore<State>({ busy: true, auth: null, attempt: null, error: null })

  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const publish = store.replace
  async function refresh() {
    try {
      const result = requireEdenData(await api.get())
      publish({
        ...store.value,
        busy: false,
        auth: v.parse(providerAuthResultSchema, normalizeEdenDates(result)),
        error: null,
      })
    } catch (error) {
      publish({ ...store.value, busy: false, error: connectionFailure(error).message })
    }
  }
  async function poll(attemptId: string, requestGeneration: number) {
    if (store.disposed || generation !== requestGeneration) return
    try {
      const result = requireEdenData(await api.login({ attemptId }).get())
      const attempt = v.parse(providerLoginAttemptSchema, normalizeEdenDates(result))
      if (store.disposed || generation !== requestGeneration) return
      publish({ ...store.value, attempt, busy: false })
      if (attempt.state === 'pending')
        timer = setTimeout(() => {
          void poll(attemptId, requestGeneration)
        }, 1000)
      if (attempt.state === 'succeeded') await refresh()
    } catch (error) {
      if (generation === requestGeneration)
        publish({ ...store.value, busy: false, error: connectionFailure(error).message })
    }
  }
  async function start(method: ProviderSignInMethod) {
    if (store.value.busy || store.value.attempt?.state === 'pending' || store.disposed) return
    const requestGeneration = ++generation
    publish({ ...store.value, busy: true, error: null, attempt: null })
    try {
      const result = requireEdenData(await api.login.post({ method }))
      const attempt = v.parse(providerLoginAttemptSchema, normalizeEdenDates(result))
      if (store.disposed || generation !== requestGeneration) {
        await cancelStartedAttempt(attempt)
        return
      }
      publish({ ...store.value, busy: false, attempt })
      if (attempt.state === 'pending')
        timer = setTimeout(() => {
          void poll(attempt.attemptId, requestGeneration)
        }, 1000)
      if (attempt.state === 'succeeded') await refresh()
    } catch (error) {
      if (store.disposed || generation !== requestGeneration) {
        record?.({
          area: 'tui.provider.auth',
          action: 'cancel',
          providerInstanceId,
          error: connectionFailure(error).message,
        })
        return
      }
      publish({ ...store.value, busy: false, error: connectionFailure(error).message })
    }
  }
  async function cancel() {
    generation += 1
    if (timer) clearTimeout(timer)
    const attemptId = store.value.attempt?.attemptId
    if (store.value.attempt?.state !== 'pending' || !attemptId) return
    const result = requireEdenData(await api.login({ attemptId }).cancel.post())
    publish({
      ...store.value,
      attempt: v.parse(providerLoginAttemptSchema, normalizeEdenDates(result)),
    })
  }
  async function cancelStartedAttempt(attempt: ProviderLoginAttempt) {
    if (attempt.state !== 'pending') return
    requireEdenData(await api.login({ attemptId: attempt.attemptId }).cancel.post())
  }
  async function signOut() {
    if (store.value.busy || store.disposed) return
    publish({ ...store.value, busy: true, error: null })
    try {
      requireEdenData(await api.logout.post())
      await refresh()
    } catch (error) {
      publish({ ...store.value, busy: false, error: connectionFailure(error).message })
    }
  }
  return {
    refresh,
    start,
    cancel,
    signOut,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose() {
      store.dispose()
      if (timer) clearTimeout(timer)
      void cancel().catch((error: unknown) =>
        record?.({
          area: 'tui.provider.auth',
          action: 'cancel',
          providerInstanceId,
          error: connectionFailure(error).message,
        }),
      )
    },
  }
}
