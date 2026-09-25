import { onTestFinished } from 'vitest'
import { commands } from 'vitest/browser'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { createTestApplicationRuntime } from './application-runtime'
import { createTestNavigation } from './navigation'

export async function createBrowserWorkspace(path: string) {
  const application = createTestApplicationRuntime()
  const queryClient = application.getSnapshot().queryClient
  queryClient.clear()
  const opened = await openAlone(application, path)
  if (opened !== 'opened' && opened !== 'already-open')
    throw createClientInvariantError(`Browser workspace ${path} could not be opened: ${opened}`)
  const navigation = createTestNavigation({ application })
  onTestFinished(() => {
    navigation.dispose()
    queryClient.clear()
  })
  return { application, navigation, queryClient }
}

// Registered in `vitest.browser.config.ts` under `browser.commands`.
declare module 'vitest/browser' {
  interface BrowserCommands {
    acquireWorkspaceOpen: () => Promise<void>
    releaseWorkspaceOpen: () => Promise<void>
  }
}

/** Parallel test files share one file server, whose workspace open is latest-wins. */
async function openAlone(application: ApplicationRuntime, path: string) {
  await commands.acquireWorkspaceOpen()
  try {
    return await application.openEnvironmentWorkspaceRoot(activeEnvironmentId(), path)
  } finally {
    await commands.releaseWorkspaceOpen()
  }
}
