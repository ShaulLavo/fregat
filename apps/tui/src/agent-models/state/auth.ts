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
  let state: State = { busy: true, auth: null, attempt: null, error: null }
  let disposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  function publish(next: State) {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  async function refresh() {
    try {
      const result = requireEdenData(await api.get())
      publish({
        ...state,
        busy: false,
        auth: v.parse(providerAuthResultSchema, normalizeEdenDates(result)),
        error: null,
      })
    } catch (error) {
      publish({ ...state, busy: false, error: connectionFailure(error).message })
    }
  }
  async function poll(attemptId: string, requestGeneration: number) {
    if (disposed || generation !== requestGeneration) return
    try {
      const result = requireEdenData(await api.login({ attemptId }).get())
      const attempt = v.parse(providerLoginAttemptSchema, normalizeEdenDates(result))
      if (disposed || generation !== requestGeneration) return
      publish({ ...state, attempt, busy: false })
      if (attempt.state === 'pending')
        timer = setTimeout(() => {
          void poll(attemptId, requestGeneration)
        }, 1000)
      if (attempt.state === 'succeeded') await refresh()
    } catch (error) {
      if (generation === requestGeneration)
        publish({ ...state, busy: false, error: connectionFailure(error).message })
    }
  }
  async function start(method: ProviderSignInMethod) {
    if (state.busy || state.attempt?.state === 'pending' || disposed) return
    const requestGeneration = ++generation
    publish({ ...state, busy: true, error: null, attempt: null })
    try {
      const result = requireEdenData(await api.login.post({ method }))
      const attempt = v.parse(providerLoginAttemptSchema, normalizeEdenDates(result))
      if (disposed || generation !== requestGeneration) {
        await cancelStartedAttempt(attempt)
        return
      }
      publish({ ...state, busy: false, attempt })
      if (attempt.state === 'pending')
        timer = setTimeout(() => {
          void poll(attempt.attemptId, requestGeneration)
        }, 1000)
      if (attempt.state === 'succeeded') await refresh()
    } catch (error) {
      if (disposed || generation !== requestGeneration) {
        record?.({
          area: 'tui.provider.auth',
          action: 'cancel',
          providerInstanceId,
          error: connectionFailure(error).message,
        })
        return
      }
      publish({ ...state, busy: false, error: connectionFailure(error).message })
    }
  }
  async function cancel() {
    generation += 1
    if (timer) clearTimeout(timer)
    const attemptId = state.attempt?.attemptId
    if (state.attempt?.state !== 'pending' || !attemptId) return
    const result = requireEdenData(await api.login({ attemptId }).cancel.post())
    publish({ ...state, attempt: v.parse(providerLoginAttemptSchema, normalizeEdenDates(result)) })
  }
  async function cancelStartedAttempt(attempt: ProviderLoginAttempt) {
    if (attempt.state !== 'pending') return
    requireEdenData(await api.login({ attemptId: attempt.attemptId }).cancel.post())
  }
  async function signOut() {
    if (state.busy || disposed) return
    publish({ ...state, busy: true, error: null })
    try {
      requireEdenData(await api.logout.post())
      await refresh()
    } catch (error) {
      publish({ ...state, busy: false, error: connectionFailure(error).message })
    }
  }
  return {
    refresh,
    start,
    cancel,
    signOut,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      void cancel().catch((error: unknown) =>
        record?.({
          area: 'tui.provider.auth',
          action: 'cancel',
          providerInstanceId,
          error: connectionFailure(error).message,
        }),
      )
      listeners.clear()
    },
  }
}
