import { Toaster } from '@workspace/ui/components/sonner'
import { toast } from 'sonner'
import { SessionDialogs } from '@/components/session-dialogs'
import { ChatPanelHeader } from '@/features/chat/components/chat-panel-header'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  healthDescriptorSchema,
  sessionIdSchema,
  commandIdSchema,
  orchestrationDispatchResultSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  type ClientOrchestrationCommand,
} from '@workspace/contracts'
import * as v from 'valibot'
import { onTestFinished } from 'vitest'
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import {
  ChatModeSessionContext,
  type ChatModeSession,
} from '@/features/chat-mode/providers/session-context'
import { ChatRailOrderProvider } from '@/features/chat-mode/providers/rail-order-provider'
import { SessionRail } from '@/features/chat-mode/components/session-rail'
import { ProjectDeleteDialog } from '@/features/chat-mode/components/project-delete-dialog'
import { ProjectRenameDialog } from '@/features/chat-mode/components/project-rename-dialog'
import { StageHeader } from '@/features/chat-mode/components/stage-header'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import {
  resetSessionSelectionStore,
  useSessionSelectionStore,
} from '@/features/chat-mode/state/session-selection-store'
import { resetRailOrderIntents } from '@/features/chat-mode/state/rail-order-intents'
import { resetSessionUndo } from '@/features/chat-mode/state/session-undo'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  activeServerOrigin,
  setActiveServerOrigin,
  setClient,
  getClient,
  type Client,
} from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { createApplicationRuntime } from '@/state/application-runtime'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { renderWithProviders } from '../render'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import type { FocusService } from '@/lib/focus/state/service'
import type { TestServer } from '../server'

let harnessOriginSequence = 0

export async function createRailHarness(
  client: Client,
  server: TestServer,
  titles: readonly string[] = ['First', 'Second'],
  rootPath = 'project',
) {
  const previousEnvironments = useEnvironmentsStore.getState()
  const previousOrigin = activeServerOrigin()
  const previousClient = getClient()
  const origin = `http://localhost:${37600 + harnessOriginSequence++}`
  setActiveServerOrigin(origin)
  setClient(client)
  const descriptor = v.parse(
    healthDescriptorSchema,
    unwrapEdenResponse(await client.health.get(), {
      requireData: true,
      emptyMessage: 'health missing',
    }),
  )
  useEnvironmentsStore.setState({
    activeOrigin: origin,
    entries: {
      [origin]: {
        ...createEnvironmentEntry(origin, origin),
        origin,
        kind: 'primary',
        phase: 'live',
        label: descriptor.label,
        descriptor,
        environmentId: descriptor.environmentId,
      },
    },
  })
  const environmentId = descriptor.environmentId
  const dispatch = async (command: ClientOrchestrationCommand) =>
    v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(await client.orchestration.commands.post(command), {
        requireData: true,
        normalizeDates: true,
        emptyMessage: 'receipt missing',
      }),
    )
  if (rootPath !== '') await mkdir(join(server.root, rootPath))
  const receipt = await dispatch(
    createProjectRegistrationCommand({
      workspaceRoot: rootPath || server.root,
      title: 'Rail project',
    }),
  )
  const { projectId, worktreeId } = receipt.result!
  const sessionIds = titles.map((_, index) =>
    v.parse(sessionIdSchema, `f0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  )
  for (const [index, title] of titles.entries())
    await dispatch({
      type: 'session.create',
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      commandId: v.parse(commandIdSchema, `rail-session-${index}`),
      sessionId: sessionIds[index]!,
      worktreeTarget: { kind: 'current', worktreeId: worktreeId },
      title,
      modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
    })
  useChatProjectionStore.getState().resetChatProjection()
  const refresh = async () => {
    const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
    useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
    return snapshot
  }
  const snapshot = await refresh()
  useWorktreeManagerStore.getState().closeManager()
  resetSessionSelectionStore()
  resetRailOrderIntents()
  resetSessionUndo()
  useSessionMultiSelectStore.getState().clear()
  useSessionRailStore.setState({
    collapsedProjectIds: [],
    query: '',
    renaming: null,
    scope: null,
    machineFilter: null,
    view: 'active',
  })
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(activeEnvironmentId())),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  await application.openEnvironmentWorkspaceRoot(environmentId, rootPath)
  application.getSnapshot().editor.workspaceStore.getState().setUiMode('chat')
  const firstSessionId = sessionIds[0]
  if (firstSessionId)
    useSessionSelectionStore.getState().restoreSession(environmentId, projectId, firstSessionId)
  const transport = createChatTransport(origin, {
    createSocket: inProcessOrchestrationSocketFactory({
      app: server.app,
      clientOrigin: server.origin,
    }),
  })
  const context: ChatModeSession = {
    activeSession: { status: 'ready', sessionId: sessionIds[0]! },
    addProject: () => {},
    transport,
    error: null,
    project: snapshot.projects.find((project) => project.id === projectId)!,
    worktree: snapshot.worktrees.find((worktree) => worktree.id === worktreeId)!,
    ready: true,
    retrying: false,
    retryProject: () => {},
    rootPath: server.root,
  }
  onTestFinished(() => {
    toast.dismiss()
    transport.close()
    application.dispose()
    useEnvironmentsStore.setState(previousEnvironments, true)
    setActiveServerOrigin(previousOrigin)
    setClient(previousClient)
  })
  return {
    context,
    environmentId,
    projectId,
    worktreeId,
    sessionIds,
    dispatch,
    refresh,
    application,
  }
}
type RailHarness = Awaited<ReturnType<typeof createRailHarness>>

function firstRow(harness: RailHarness) {
  const model = sessionRailModel({ environments: currentRailEnvironments() })
  return model.sessions.find((session) => session.id === harness.sessionIds[0]) ?? null
}

export function renderInRailHarness(
  harness: RailHarness,
  children: ReactNode,
  focusService?: FocusService,
) {
  return renderWithProviders(
    <EditorStateProvider runtime={harness.application.getSnapshot().editor}>
      <ChatModeSessionContext value={harness.context}>{children}</ChatModeSessionContext>
    </EditorStateProvider>,
    {
      application: harness.application,
      focusService,
      queryClient: harness.application.getSnapshot().queryClient,
    },
  )
}

export function renderRailHarness(
  harness: RailHarness,
  header = false,
  onRender: ProfilerOnRenderCallback = () => {},
  focusService?: FocusService,
) {
  const row = firstRow(harness)
  return renderInRailHarness(
    harness,
    <ChatRailOrderProvider>
      {header ? (
        <StageHeader
          contextUsage={null}
          projectTitle={harness.context.project?.title ?? null}
          session={row}
        />
      ) : (
        <Profiler id='rail' onRender={onRender}>
          <SessionRail />
        </Profiler>
      )}
      <SessionDialogs />
      <Toaster />
      <ProjectDeleteDialog />
      <ProjectRenameDialog />
    </ChatRailOrderProvider>,
    focusService,
  )
}

/**
 * Both headers that act on one conversation, side by side over the same scoped
 * session: the chat stage's and the editor sidebar's. The dialogs come from the
 * shared owner, as they do in the app.
 */
export function renderSessionHeaders(harness: RailHarness) {
  const row = firstRow(harness)
  return renderInRailHarness(
    harness,
    <>
      <section aria-label='Stage header'>
        <StageHeader
          contextUsage={null}
          projectTitle={harness.context.project?.title ?? null}
          session={row}
        />
      </section>
      <section aria-label='Sidebar header'>
        <ChatPanelHeader
          activeSessionId={row?.id ?? null}
          creating={false}
          disabled={false}
          session={row}
          sessions={[]}
          onNewChat={() => {}}
          onSelectSession={() => {}}
        />
      </section>
      <SessionDialogs />
      <Toaster />
    </>,
  )
}
