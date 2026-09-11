import type { EnvironmentId, ProjectId, SessionId } from '@workspace/contracts'
import { create } from 'zustand'

export type SidebarSelection =
  | { readonly kind: 'auto' }
  | { readonly kind: 'draft'; readonly environmentId: EnvironmentId; readonly projectId: ProjectId }
  | {
      readonly kind: 'session'
      readonly environmentId: EnvironmentId
      readonly projectId: ProjectId
      readonly sessionId: SessionId
    }

type SidebarSelectionStore = {
  readonly selection: SidebarSelection
  readonly restoreSelection: (selection: SidebarSelection) => void
}

export const useSidebarSelectionStore = create<SidebarSelectionStore>((set) => ({
  selection: { kind: 'auto' },
  restoreSelection: (selection) => set({ selection }),
}))
