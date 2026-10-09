import { useMutation } from '@tanstack/react-query'

import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { onboardingMutationKeys } from '@/features/onboarding/utils/mutation-keys'
import { machineUnreachableError } from '@/features/onboarding/utils/structured-errors'

/** Connects a saved machine through its connection owner; resolves once its identity is confirmed. */
export function useConnectMachine() {
  const connections = useEnvironmentConnections()

  return useMutation({
    mutationKey: onboardingMutationKeys.connectMachine,
    // One connection attempt at a time: a second tap waits for the first one's answer.
    scope: { id: 'onboarding-connect-machine' },
    mutationFn: async (name: string) => {
      const result = await connections.connectMachine(name)
      if (result !== 'connected') throw machineUnreachableError(name, result)
      return name
    },
  })
}
