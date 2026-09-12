import type { ScopedProjectRef } from '@workspace/contracts'
import { create } from 'zustand'

type ProjectRenameRequest = {
  readonly ref: ScopedProjectRef
  readonly title: string
}

/**
 * The project a rename is currently asking about. Outside the rail for the same
 * reason the delete request is: the header that raised the question re-renders
 * under the dialog, and the dialog has to outlive it.
 */
type ProjectRenameRequestStore = {
  readonly request: ProjectRenameRequest | null
  readonly dismissRename: () => void
  readonly requestRename: (request: ProjectRenameRequest) => void
}

export const useProjectRenameRequestStore = create<ProjectRenameRequestStore>()((set) => ({
  dismissRename: () => set({ request: null }),
  request: null,
  requestRename: (request) => set({ request }),
}))
