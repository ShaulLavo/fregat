import { restartGateSignature } from '@/features/chat/utils/restart-gate-signature'
import { createReloadSafetyStore } from '@/lib/reload-safety'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { updateIntentStore } from '@/features/server-update/state/intent'
import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { prepareSearchReload } from '@/features/search/state/result-scroll-state'
import { prepareTerminalReload } from '@/features/terminal/state/reload'
import { prepareLogsViewReload } from '@/features/logs/state/view-reload'
import { prepareGitReload } from '@/features/git/state/reload'
import { prepareSettingsReload } from '@/features/settings/state/reload'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { prepareTreeReload } from '@/features/workspace/state/tree-reload'
import type { EnvironmentId, SettingsValues } from '@workspace/contracts'
import { retainedTextBudgetFromSettings } from '@/features/editor/utils/retained-text-budget'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { openWorkspaceRootForOwner } from '@/features/workspace/state/open-root'
import { createEditorApplyActions } from '@/features/editor/state/apply-actions'
import { createEnvironmentConnections } from '@/state/environment-connections'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import {
  environmentScopedStorage,
  type ScopedStorage,
} from '@/lib/environments/state/scoped-storage'
import { initializeEnvironmentPersistence } from '@/state/environment-persistence'
import { restoreEnvironmentSessionSelection } from '@/features/chat-mode/state/session-selection-store'
import { resetLanguageServerConnectionPool } from '@/features/editor/state/language-server-connection-pool'
import { markerStore } from '@/lib/markers/store'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/state/runtime'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorPreparedEnvironment } from '@/features/editor/utils/prepared-document'
import {
  readWorkspaceCache,
  writeSessionSelectionCache,
  type CachedWorkspaceState,
} from '@/features/workspace/state/cache'
import type { ChatSelection } from '@/lib/chat-selection'
import { subscribeWorkspaceCachePersistence } from '@/features/workspace/state/cache-persistence'
import { activateWorkspaceRoot } from '@/features/workspace/state/active-project'
import { createCommandRuntimeBinding } from '@/keymap/state/runtime-binding'
import { canonicalServerOrigin } from '@workspace/client-core/transport/client'
import { activeServerOrigin, primaryServerOrigin } from '@/lib/client'
import {
  resumeEnvironmentActivity,
  suspendEnvironmentActivity,
} from '@/lib/environments/state/activity'
import { primaryQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { subscribeLiveSettings, watchSettingValue } from '@/features/settings/state/live-projection'
import { setSimulatedLatencyMs } from '@/lib/simulated-latency'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'

type RetainedEnvironment = {
  readonly origin: string
  readonly queryClient: QueryClient
  readonly editor: EditorRuntime
  readonly stopSearchReload: () => void
  readonly stopCachePersistence: () => void
  readonly stopSpellcheckWords: () => void
  readonly stopReloadSafety: () => void
  readonly unsubscribeRoot: () => void
}

function prepareReloadOwners(
  queryClient: QueryClient,
  windowStorage: ScopedStorage,
  root: string | null,
) {
  prepareGitReload(queryClient, windowStorage, root)
  prepareTerminalReload(queryClient, windowStorage, root)
  prepareLogsViewReload(queryClient, windowStorage, root)
  prepareSettingsReload(queryClient, windowStorage, root)
}

export function createApplicationRuntime({
  workspaceCache,
  preparation,
  initialSession,
}: {
  readonly workspaceCache: CachedWorkspaceState
  readonly preparation: EditorPreparedEnvironment
  readonly initialSession?: {
    readonly environmentId: EnvironmentId
    readonly selection: ChatSelection
  }
}) {
  const commandBinding = createCommandRuntimeBinding()
  const reloadSafety = createReloadSafetyStore()
  const environments = new Map<EnvironmentId, RetainedEnvironment>()
  let current: RetainedEnvironment
  let started = false
  let disposed = false

  function syncReloadSafety() {
    const dirtyFiles: string[] = []
    for (const { editor } of environments.values()) {
      const state = editor.documentStore.getState()
      for (const document of Object.values(state.liveDocumentsByKey)) {
        if (!state.dirtyDocumentKeys.has(document.key) && !document.buffer.isDirty()) continue
        dirtyFiles.push(documentSourcePath(document.target) ?? String(document.key))
      }
    }
    const previous = reloadSafety.getState().dirtyFiles
    if (
      previous.length === dirtyFiles.length &&
      previous.every((file, index) => file === dirtyFiles[index])
    )
      return
    reloadSafety.setState({ dirtyFiles })
  }

  // Only the active machine's editor runs, and not while ConnectionGate withholds its workbench.
  function syncActiveEditor() {
    if (!started || disposed) return
    if (refusedBeforeHandshake(current.origin)) current.editor.suspend()
    else current.editor.resume()
  }

  function createEnvironment(origin: string, seed: CachedWorkspaceState): RetainedEnvironment {
    const storage = environmentScopedStorage(confirmedEnvironmentId(origin))
    initializeEnvironmentPersistence(storage)
    const queryClient = queryClientFor(origin)
    const windowStorage = environmentWindowStorage(storage.environmentId)
    prepareTreeReload(queryClient, windowStorage)
    prepareReloadOwners(queryClient, windowStorage, seed.rootFolder?.path ?? null)
    const editor = createEditorRuntime({
      queryClient,
      storage,
      workspaceCache: seed,
      preparation,
    })
    const stopSearchReload = prepareSearchReload(editor.searchBufferStore, windowStorage)
    queryClient.mount()
    return {
      origin,
      queryClient,
      editor,
      stopSearchReload,
      stopReloadSafety: editor.documentStore.subscribe(
        (state) => state.dirtyDocumentKeys,
        syncReloadSafety,
      ),
      // Before any recovery, so a recovered root recreates its erased cache entry.
      stopCachePersistence: subscribeWorkspaceCachePersistence({
        storage,
        documentStore: editor.documentStore,
        searchStore: editor.searchBufferStore,
        workspaceStore: editor.workspaceStore,
      }),
      // `false` entries un-accept a word the merged dictionary would otherwise accept.
      stopSpellcheckWords: watchSettingValue(primaryQueryClient(), 'spellcheck.words', (words) =>
        editor.spellcheck.setAcceptedWords(
          Object.entries(words).flatMap(([word, accepted]) => (accepted ? [word] : [])),
        ),
      ),
      unsubscribeRoot: editor.workspaceStore.subscribe(
        (state) => state.rootFolder?.path ?? null,
        (root) => {
          prepareReloadOwners(queryClient, windowStorage, root)
          if (current.editor === editor) activateWorkspaceRoot(root)
        },
      ),
    }
  }

  function restoreSessionSelection(environmentId: EnvironmentId) {
    if (initialSession?.environmentId === environmentId) {
      writeSessionSelectionCache(environmentScopedStorage(environmentId), initialSession.selection)
      initialSession = undefined
    }
    restoreEnvironmentSessionSelection(environmentId)
  }

  current = createEnvironment(activeServerOrigin(), workspaceCache)
  restoreSessionSelection(confirmedEnvironmentId(current.origin))
  resumeEnvironmentActivity(current.origin)
  environments.set(confirmedEnvironmentId(current.origin), current)
  syncReloadSafety()
  activateWorkspaceRoot(current.editor.workspaceStore.getState().rootFolder?.path ?? null)

  const connections = createEnvironmentConnections()
  let updateGateSignature = ''
  const stopUpdateGate = useChatProjectionStore.subscribe((state, previous) => {
    if (updateIntentStore.getState().intent.kind !== 'waiting') return
    const primary = useEnvironmentsStore.getState().entries[primaryServerOrigin()]?.environmentId
    if (!primary) return
    const slice = state.slices[primary]
    if (slice?.sessionById === previous.slices[primary]?.sessionById) return
    const signature = restartGateSignature(slice)
    if (signature === updateGateSignature) return
    updateGateSignature = signature
    void primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  })
  const stopAdmissionWatch = useEnvironmentsStore.subscribe(syncActiveEditor)
  const stopLatency = watchSettingValue(
    primaryQueryClient(),
    'developer.simulatedLatencyMs',
    setSimulatedLatencyMs,
  )
  let machines: SettingsValues['environments.machines'] | undefined
  // Machines wait for the settings document: configuring from boot values would let the
  // settings authority forget machines the document lists.
  const stopMachines = subscribeLiveSettings(primaryQueryClient(), (settings) => {
    const next = settings?.values['environments.machines']
    if (!next || next === machines) return
    machines = next
    connections.configureMachines(next)
  })

  const application = {
    connections,
    reloadSafety,
    commandBinding,
    getSnapshot: () => current,
    getEnvironment: (environmentId: EnvironmentId) => environments.get(environmentId),
    getEditorForWorkspace(workspace: EditorWorkspaceStoreApi) {
      for (const { editor } of environments.values()) {
        if (editor.workspaceStore === workspace) return editor
      }
      return null
    },
    subscribe: (listener: () => void) => useEnvironmentsStore.subscribe(listener),
    /** Resumes the active editor; the boot calls it after pairing, so the first request is paired. */
    start() {
      started = true
      syncActiveEditor()
    },
    activateEnvironment(origin: string) {
      origin = canonicalServerOrigin(origin)
      if (disposed || current.origin === origin) return
      const environmentId = confirmedEnvironmentId(origin)
      const next =
        environments.get(environmentId) ??
        createEnvironment(origin, readWorkspaceCache(environmentScopedStorage(environmentId)))
      environments.set(environmentId, next)
      syncReloadSafety()
      if (current === next) return
      commandBinding.clear()
      suspendEnvironmentActivity(current.origin)
      resetLanguageServerConnectionPool()
      markerStore.clear()
      current.editor.suspend()
      void current.queryClient.cancelQueries()
      resumeEnvironmentActivity(next.origin)
      current = next
      syncActiveEditor()
      activateWorkspaceRoot(current.editor.workspaceStore.getState().rootFolder?.path ?? null)
      restoreSessionSelection(environmentId)
      useEnvironmentsStore.getState().activate(next.origin)
    },
    async openEnvironmentWorkspaceRoot(
      environmentId: EnvironmentId,
      path: string,
      options: { readonly isCurrent?: () => boolean; readonly signal?: AbortSignal } = {},
    ) {
      if (options.isCurrent?.() === false || options.signal?.aborted) return 'superseded' as const
      const origin = confirmedEnvironmentOrigin(environmentId)
      application.activateEnvironment(origin)
      const owner = current
      const editor = owner.editor
      const commands = createEditorApplyActions({
        retainedTextBudget: retainedTextBudgetFromSettings,
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
        options,
      )
    },
    hasUnsavedDocuments: () =>
      [...environments.values()].some(({ editor }) => editor.hasUnsavedDocuments()),
    dispose() {
      disposed = true
      stopAdmissionWatch()
      stopUpdateGate()
      commandBinding.clear()
      stopLatency()
      stopMachines()
      connections.stop()
      for (const environment of environments.values()) {
        suspendEnvironmentActivity(environment.origin)
        environment.unsubscribeRoot()
        environment.stopReloadSafety()
        environment.stopSearchReload()
        environment.stopCachePersistence()
        environment.stopSpellcheckWords()
        environment.editor.dispose()
        environment.queryClient.unmount()
      }
      environments.clear()
      resetLanguageServerConnectionPool()
      markerStore.clear()
    },
  }
  return application
}

export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>

/** ConnectionGate's rule: a refusal before this page's first handshake keeps the workbench out. */
function refusedBeforeHandshake(origin: string) {
  const connection = selectServerConnection(useEnvironmentsStore.getState(), origin)
  const refused = connection.phase === 'identity-drift' || connection.phase === 'protocol-mismatch'
  return refused && connection.generation === 0
}
