import { mutationOptions } from '@tanstack/react-query'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type { TabPlacement, GroupResize } from '@/lib/documents/utils/group-types'
import type { NavigationResult } from '@/state/navigation-coordinator'

export function placementMutationOptions(
  scope: string,
  place: (placement: TabPlacement) => Promise<NavigationResult>,
) {
  return mutationOptions({
    mutationKey: editorMutationKeys.place(scope),
    scope: { id: scope },
    mutationFn: place,
    retry: false,
  })
}

export function resizeMutationOptions(
  scope: string,
  resize: (request: GroupResize) => Promise<NavigationResult>,
) {
  return mutationOptions({
    mutationKey: editorMutationKeys.resize(scope),
    scope: { id: scope },
    mutationFn: resize,
    retry: false,
  })
}
