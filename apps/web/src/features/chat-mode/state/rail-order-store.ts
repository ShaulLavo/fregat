import {
  scopedProjectKey,
  scopedSessionKey,
  type ScopedProjectRef,
  type ScopedSessionRef,
} from '@workspace/contracts'
import { create } from 'zustand'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
  type ChatProjectionState,
} from '@/features/chat/state/chat-projection-store'
import type { RailOrderOverrides } from '@workspace/client-core/chat/rail/model'
type RailOrderStore = RailOrderOverrides & {
  readonly placeProject: (ref: ScopedProjectRef, key: string) => void
  readonly placeSession: (ref: ScopedSessionRef, key: string) => void
  readonly releaseProject: (ref: ScopedProjectRef) => void
  readonly releaseSession: (ref: ScopedSessionRef) => void
}
export const useRailOrderStore = create<RailOrderStore>()((set) => ({
  projectOrderKeys: {},
  sessionOrderKeys: {},
  placeProject: (ref, key) =>
    set((state) => ({
      projectOrderKeys: { ...state.projectOrderKeys, [scopedProjectKey(ref)]: key },
    })),
  placeSession: (ref, key) =>
    set((state) => ({
      sessionOrderKeys: { ...state.sessionOrderKeys, [scopedSessionKey(ref)]: key },
    })),
  releaseProject: (ref) =>
    set((state) => ({
      projectOrderKeys: withoutKey(state.projectOrderKeys, scopedProjectKey(ref)),
    })),
  releaseSession: (ref) =>
    set((state) => ({
      sessionOrderKeys: withoutKey(state.sessionOrderKeys, scopedSessionKey(ref)),
    })),
}))
export function resetRailOrderStore() {
  useRailOrderStore.setState({ projectOrderKeys: {}, sessionOrderKeys: {} })
}
export function settleProjectOrder(ref: ScopedProjectRef, orderKey: string) {
  settleWhenProjected({
    orderKey,
    pending: () => useRailOrderStore.getState().projectOrderKeys[scopedProjectKey(ref)],
    projected: (state) =>
      selectChatProjectionSlice(state, ref.environmentId).projectById[ref.projectId]?.orderKey ??
      null,
    release: () => useRailOrderStore.getState().releaseProject(ref),
  })
}
export function settleSessionOrder(ref: ScopedSessionRef, orderKey: string) {
  settleWhenProjected({
    orderKey,
    pending: () => useRailOrderStore.getState().sessionOrderKeys[scopedSessionKey(ref)],
    projected: (state) =>
      selectChatProjectionSlice(state, ref.environmentId).sessionById[ref.sessionId]?.pinOrderKey ??
      null,
    release: () => useRailOrderStore.getState().releaseSession(ref),
  })
}
function settleWhenProjected({
  orderKey,
  pending,
  projected,
  release,
}: {
  readonly orderKey: string
  readonly pending: () => string | undefined
  readonly projected: (state: ChatProjectionState) => string | null
  readonly release: () => void
}) {
  if (projected(useChatProjectionStore.getState()) === orderKey) {
    release()
    return
  }
  const unsubscribe = useChatProjectionStore.subscribe((state) => {
    if (pending() !== orderKey) {
      unsubscribe()
      return
    }
    if (projected(state) !== orderKey) return
    unsubscribe()
    release()
  })
}
function withoutKey(keys: Readonly<Record<string, string>>, key: string) {
  const next = { ...keys }
  delete next[key]
  return next
}
