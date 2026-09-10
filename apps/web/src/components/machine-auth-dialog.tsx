import { useMachineAuth } from '@/hooks/use-machine-auth'
import { MachineAuthForm } from '@/components/machine-auth-form'

export function MachineAuthDialog() {
  const { prompt } = useMachineAuth()
  if (!prompt) return null
  return <MachineAuthForm key={prompt.id} prompt={prompt} />
}
