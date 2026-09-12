import { useAuth } from '@/features/environments/hooks/use-auth'
import { AuthForm } from '@/features/environments/components/auth-form'

export function AuthDialog() {
  const { prompt } = useAuth()
  if (!prompt) return null
  return <AuthForm key={prompt.id} prompt={prompt} />
}
