import { onTestFinished } from 'vitest'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { createClientInvariantError } from '@/lib/structured-errors'
import { createTestApplicationRuntime } from './application-runtime'
import { createTestNavigation } from './navigation'

export async function createBrowserWorkspace(path: string) {
  const application = createTestApplicationRuntime()
  const queryClient = application.getSnapshot().queryClient
  queryClient.clear()
  const opened = await application.openEnvironmentWorkspaceRoot(activeEnvironmentId(), path)
  if (opened !== 'opened' && opened !== 'already-open')
    throw createClientInvariantError(`Browser workspace ${path} could not be opened: ${opened}`)
  const navigation = createTestNavigation({ application })
  onTestFinished(() => {
    navigation.dispose()
    queryClient.clear()
  })
  return { application, navigation, queryClient }
}
