import type { EnvironmentId } from '@workspace/contracts'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { openWorkspaceRootForOwner } from '@/features/workspace/state/open-root'
import { createEditorCommands } from '@/features/editor/state/commands'
import { createEnvironmentConnections } from '@/state/environment-connections'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { initializeEnvironmentPersistence } from '@/state/environment-persistence'
import { restoreEnvironmentSessionSelection } from '@/features/chat-mode/state/session-selection-store'
import { resetLanguageServerConnectionPool } from '@/features/editor/state/language-server-connection-pool'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/state/runtime'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorPreparedEnvironment } from '@/features/editor/utils/prepared-document'
import { readWorkspaceCache, type CachedWorkspaceState } from '@/features/workspace/state/cache'
import { activateWorkspaceRoot } from '@/features/workspace/state/active-project'
import { createCommandRuntimeBinding } from '@/keymap/state/runtime-binding'
import { canonicalServerOrigin } from '@workspace/client-core/transport/client'
import { activeServerOrigin } from '@/lib/client'
import {
  resumeEnvironmentActivity,
  suspendEnvironmentActivity,
} from '@/lib/environments/state/activity'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

type RetainedEnvironment = {
  readonly origin: string
  readonly queryClient: QueryClient
  readonly editor: EditorRuntime
  readonly unsubscribeRoot: () => void
}

export function createApplicationRuntime({
  workspaceCache,
  preparation,
}: {
  readonly workspaceCache: CachedWorkspaceState
  readonly preparation: EditorPreparedEnvironment
}) {
  const commandBinding = createCommandRuntimeBinding()
  const environments = new Map<EnvironmentId, RetainedEnvironment>()
  let current: RetainedEnvironment

  function createEnvironment(
    origin: string,
    seed: CachedWorkspaceState,
    restoreAddress = true,
  ): RetainedEnvironment {
    const storage = environmentScopedStorage(confirmedEnvironmentId(origin))
    initializeEnvironmentPersistence(storage)
    const queryClient = queryClientFor(origin)
    const editor = createEditorRuntime({
      queryClient,
      storage,
      workspaceCache: seed,
      preparation,
      restoreAddress,
    })
    queryClient.mount()
    return {
      origin,
      queryClient,
      editor,
      unsubscribeRoot: editor.workspaceStore.subscribe(
        (state) => state.rootFolder?.path ?? null,
        (root) => {
          if (current.editor === editor) activateWorkspaceRoot(root)
        },
      ),
    }
  }

  current = createEnvironment(activeServerOrigin(), workspaceCache)
  restoreEnvironmentSessionSelection(confirmedEnvironmentId(current.origin))
  resumeEnvironmentActivity(current.origin)
  environments.set(confirmedEnvironmentId(current.origin), current)
  activateWorkspaceRoot(current.editor.workspaceStore.getState().rootFolder?.path ?? null)

  const connections = createEnvironmentConnections({
    activateEnvironment: (environmentId) =>
      application.activateEnvironment(confirmedEnvironmentOrigin(environmentId)),
  })

  const application = {
    connections,
    commandBinding,
    getSnapshot: () => current,
    subscribe: (listener: () => void) => useEnvironmentsStore.subscribe(listener),
    activateEnvironment(origin: string) {
      origin = canonicalServerOrigin(origin)
      if (current.origin === origin) return
      const environmentId = confirmedEnvironmentId(origin)
      const next =
        environments.get(environmentId) ??
        createEnvironment(
          origin,
          readWorkspaceCache(environmentScopedStorage(environmentId)),
          false,
        )
      environments.set(environmentId, next)
      if (current === next) return
      commandBinding.clear()
      suspendEnvironmentActivity(current.origin)
      resetLanguageServerConnectionPool()
      current.editor.suspend()
      void current.queryClient.cancelQueries()
      resumeEnvironmentActivity(next.origin)
      current = next
      activateWorkspaceRoot(current.editor.workspaceStore.getState().rootFolder?.path ?? null)
      restoreEnvironmentSessionSelection(environmentId)
      useEnvironmentsStore.getState().activate(next.origin)
    },
    async openEnvironmentWorkspaceRoot(environmentId: EnvironmentId, path: string) {
      const origin = confirmedEnvironmentOrigin(environmentId)
      application.activateEnvironment(origin)
      const owner = current
      const editor = owner.editor
      const commands = createEditorCommands({
        activation: editor.editorActivation,
        documentStore: editor.documentStore,
        searchStore: editor.searchBufferStore,
        uiStore: editor.uiStore,
        workspaceStore: editor.workspaceStore,
      })
      return openWorkspaceRootForOwner(
        {
          queryClient: owner.queryClient,
          switchRootFolder: commands.switchRootFolder,
          workspaceStore: editor.workspaceStore,
          workspaceEdits: editor.workspaceEditService,
        },
        path,
      )
    },
    hasUnsavedDocuments: () =>
      [...environments.values()].some(({ editor }) => editor.hasUnsavedDocuments()),
    dispose() {
      commandBinding.clear()
      connections.stop()
      for (const environment of environments.values()) {
        suspendEnvironmentActivity(environment.origin)
        environment.unsubscribeRoot()
        environment.editor.dispose()
        environment.queryClient.unmount()
      }
      environments.clear()
      resetLanguageServerConnectionPool()
    },
  }
  return application
}

export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>
