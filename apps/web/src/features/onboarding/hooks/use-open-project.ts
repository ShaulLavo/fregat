import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useNavigation } from '@/hooks/use-navigation'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { recentFolderKeys } from '@/lib/recent-folders-query'
import { onboardingMutationKeys } from '@/features/onboarding/utils/mutation-keys'
import { projectUnavailableError } from '@/features/onboarding/utils/structured-errors'
import { openMachineProject } from '@/state/project-picker'

export type OpenProjectRequest = {
  readonly machine: ConfirmedMachine
  readonly path: string
}

/** Opens the chosen folder as a project on its machine and lands in that project's chat. */
export function useOpenProject() {
  const navigation = useNavigation()
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: onboardingMutationKeys.openProject,
    mutationFn: async ({ machine, path }: OpenProjectRequest) => {
      const { opened, project } = await openMachineProject(navigation, machine, path)
      if (opened.status === 'unavailable')
        throw projectUnavailableError(machine.name, opened.reason)
      // A new draft in the project, so phone and desktop both land on its composer.
      if (opened.status === 'applied' && project)
        await navigation.startDraft(
          { environmentId: machine.environmentId, projectId: project.projectId },
          project.worktreeId,
        )
      await queryClient.invalidateQueries({ queryKey: recentFolderKeys.all })
      return opened
    },
  })
}
