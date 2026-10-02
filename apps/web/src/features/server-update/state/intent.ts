import { sameUpdateTarget, type BusySession, type StagedRelease } from '@workspace/contracts'
import { createStore } from 'zustand/vanilla'
import {
  initiatingWindowStorage,
  persistUpdateIntent,
  restoreUpdateIntent,
  type IntentStorage,
} from '@/features/server-update/utils/intent-persistence'
import { updateRestartTimeoutMs } from '@/features/server-update/utils/restart-timeout'

export type UpdateTarget = StagedRelease | { readonly release: string; readonly stagedAt: null }

export type UpdateIntent =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'confirm'
      readonly target: UpdateTarget
      readonly busy: readonly BusySession[]
    }
  | {
      readonly kind: 'waiting'
      readonly target: UpdateTarget
      readonly busy: readonly BusySession[]
      readonly gateReadAt: number
    }
  | {
      readonly kind: 'restarting'
      readonly target: UpdateTarget
      readonly confirmed: boolean
      readonly instance: string | null
      readonly fromRelease: string | null
      readonly startedAt: number
    }
  | { readonly kind: 'reload'; readonly target: UpdateTarget }
  | {
      readonly kind: 'failed'
      readonly target: UpdateTarget
      readonly reason?: 'health-check' | 'unreachable' | 'timeout' | 'request'
    }

type RestartingIntent = Extract<UpdateIntent, { kind: 'restarting' }>
type IntentInput =
  | Exclude<UpdateIntent, RestartingIntent>
  | (Omit<RestartingIntent, 'startedAt'> & { readonly startedAt?: number })

export function createUpdateIntentStore({
  storage = initiatingWindowStorage(),
  now = Date.now,
  restartTimeoutMs = updateRestartTimeoutMs,
}: {
  readonly storage?: IntentStorage | null
  readonly now?: () => number
  readonly restartTimeoutMs?: () => number
} = {}) {
  return createStore<{
    intent: UpdateIntent
    setIntent: (intent: IntentInput) => void
  }>((set, get) => ({
    intent: restoreUpdateIntent(storage, now(), restartTimeoutMs()),
    setIntent: (input) => {
      const current = get().intent
      const startedAt =
        current.kind === 'restarting' &&
        input.kind === 'restarting' &&
        sameUpdateTarget(current.target, input.target)
          ? current.startedAt
          : now()
      const intent: UpdateIntent =
        input.kind === 'restarting' ? { ...input, startedAt: input.startedAt ?? startedAt } : input
      persistUpdateIntent(storage, intent)
      set({ intent })
    },
  }))
}

export const updateIntentStore = createUpdateIntentStore()
