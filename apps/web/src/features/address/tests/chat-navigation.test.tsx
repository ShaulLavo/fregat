import { filesystemPath } from '@/lib/documents/utils/identity'
import { testNullableTabContent } from '../../../../test/factories/document-targets'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { worktreeIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import {
  AMBIGUOUS_SESSION,
  DOMAIN_MODEL,
  DOMAIN_SESSION,
} from '../../../../test/factories/session-domain'
import { pressBack, waitForNavigation } from '../../../../test/address'

test('file history in chat mode reveals the editor while main chat history preserves its tools', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  writeFileSync(path.join(domain.main, 'other.txt'), 'other file')
  await refresh()
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  await navigation.openFile({
    owner: editor.workspaceStore,
    path: filesystemPath('main/other.txt'),
  })
  await navigation.setToolPanel('logs')
  await pressBack(navigation)
  expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
    testNullableTabContent('main/keep.txt'),
  )
  expect(editor.workspaceStore.getState().chatModePanels).toMatchObject({
    activeToolTab: 'editor',
    toolPaneOpen: true,
  })
  await navigation.setToolPanel('logs')
  await pressBack(navigation)
  expect(useSessionSelectionStore.getState().selection).toMatchObject({ sessionId: DOMAIN_SESSION })
  expect(editor.workspaceStore.getState().chatModePanels.activeToolTab).toBe('logs')
})

test('sidebar conversation history reveals its destination after utility changes', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  const initialIndex = navigation.router.history.location.state.__TSR_index
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'sidebar' })
  await navigation.openChat({ environmentId, sessionId: AMBIGUOUS_SESSION, surface: 'sidebar' })
  expect(navigation.router.history.location.state.__TSR_index).toBe(initialIndex + 2)
  await navigation.setSidePanel('files')
  await navigation.setBottomPanel('problems')
  await navigation.setWorkbenchPanels({
    ...editor.workspaceStore.getState().workbenchPanels,
    sidebarOpen: false,
  })
  expect(navigation.router.history.location.state.__TSR_index).toBe(initialIndex + 2)
  await pressBack(navigation)
  expect(editor.workspaceStore.getState().workbenchPanels).toMatchObject({
    activeSidebarTab: 'chat',
    sidebarOpen: true,
    activeBottomTab: 'problems',
  })
  expect(useSidebarSelectionStore.getState().selection).toMatchObject({
    sessionId: DOMAIN_SESSION,
  })
  navigation.forward()
  await waitForNavigation(navigation)
  expect(useSidebarSelectionStore.getState().selection).toMatchObject({
    sessionId: AMBIGUOUS_SESSION,
  })
  expect(editor.workspaceStore.getState().workbenchPanels.activeSidebarTab).toBe('chat')
  await pressBack(navigation)
  await navigation.setSidePanel('logs')
  await pressBack(navigation)
  expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
    testNullableTabContent('main/keep.txt'),
  )
  expect(editor.workspaceStore.getState().workbenchPanels.activeSidebarTab).toBe('logs')
  expect(useSidebarSelectionStore.getState().selection).toMatchObject({
    sessionId: DOMAIN_SESSION,
  })
})

test('file history ignores incidental sidebar conversations even after they are deleted', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  writeFileSync(path.join(domain.main, 'other.txt'), 'other file')
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'sidebar' })
  await navigation.openFile({
    owner: editor.workspaceStore,
    path: filesystemPath('main/other.txt'),
  })
  await navigation.openChat({ environmentId, sessionId: AMBIGUOUS_SESSION, surface: 'sidebar' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  await pressBack(navigation)
  await navigation.setSidePanel('logs')
  await domain.dispatch({
    type: 'session.delete',
    commandId: 'delete-incidental-sidebar-session',
    sessionId: DOMAIN_SESSION,
  })
  await refresh()
  await pressBack(navigation)
  expect(navigation.getSnapshot().status).toBe('applied')
  expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
    testNullableTabContent('main/other.txt'),
  )
  expect(editor.workspaceStore.getState().workbenchPanels.activeSidebarTab).toBe('logs')
  expect(useSidebarSelectionStore.getState().selection).toMatchObject({
    sessionId: AMBIGUOUS_SESSION,
  })
})

test('starting a draft in another worktree of the same project updates its execution target', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  const linked = (await domain.register('register-linked', 'linked')).result
  if (!linked) return expect.unreachable('linked worktree registration is missing')
  await refresh()
  const project = { environmentId, projectId: registration.projectId }
  expect(await navigation.startDraft(project, registration.worktreeId)).toEqual({
    status: 'applied',
  })
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(registration.worktreeId)
  expect(linked.projectId).toBe(registration.projectId)
  expect(await navigation.startDraft(project, linked.worktreeId)).toEqual({ status: 'applied' })
  expect(editor.workspaceStore.getState().rootFolder?.path).toBe('linked')
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(linked.worktreeId)
  await pressBack(navigation)
  expect(editor.workspaceStore.getState().rootFolder?.path).toBe('main')
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(registration.worktreeId)
  const generation = useSessionSelectionStore.getState().draftGeneration
  expect(await navigation.startDraft(project, registration.worktreeId)).toEqual({
    status: 'applied',
  })
  expect(useSessionSelectionStore.getState().draftGeneration).toBe(generation + 1)
})

test('opening an archived session preserves the archived rail', async () => {
  const { domain, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  await domain.dispatch({
    type: 'session.archive',
    commandId: 'archive-session',
    sessionId: AMBIGUOUS_SESSION,
  })
  await refresh()
  expect(
    await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' }),
  ).toEqual({ status: 'applied' })
  expect(await navigation.setRail('archived')).toEqual({ status: 'applied' })
  expect(useSessionRailStore.getState().view).toBe('archived')
  expect(
    await navigation.openChat({ environmentId, sessionId: AMBIGUOUS_SESSION, surface: 'main' }),
  ).toEqual({ status: 'applied' })
  expect(useSessionRailStore.getState().view).toBe('archived')
  expect(navigation.currentAddress().rail).toBe('archived')
  await navigation.startDraft(
    { environmentId, projectId: registration.projectId },
    registration.worktreeId,
  )
  expect(useSessionRailStore.getState().view).toBe('active')
})

test('an acknowledged session promotes its draft before local shell catchup', async () => {
  const { domain, environmentId, navigation, registration } = await createChatNavigationFixture()
  const project = { environmentId, projectId: registration.projectId }
  expect(await navigation.startDraft(project, registration.worktreeId)).toEqual({
    status: 'applied',
  })
  await domain.createSession(registration.worktreeId)
  expect((await domain.snapshot()).sessions.some((row) => row.id === DOMAIN_SESSION)).toBe(true)
  expect(
    selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId).sessionById[
      DOMAIN_SESSION
    ],
  ).toBeUndefined()
  expect(
    await navigation.openChat({
      ...project,
      sessionId: DOMAIN_SESSION,
      surface: 'main',
      replace: true,
    }),
  ).toEqual({ status: 'applied' })
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    kind: 'session',
    sessionId: DOMAIN_SESSION,
  })
  expect(navigation.router.history.location.pathname).toContain(`/chat/t/${DOMAIN_SESSION}`)
})

test('a failed managed checkout leaves its conversation accessible from the project checkout', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  const managedId = v.parse(worktreeIdSchema, '11111111-1111-4111-8111-111111111169')
  const unsubscribe = domain.engine.subscribeDomainEvents({
    name: 'test-block-worktree-creation',
    handleEvents(events) {
      for (const event of events) {
        if (event.type !== 'worktree.create-requested') continue
        mkdirSync(path.dirname(event.payload.canonicalPath), { recursive: true })
        writeFileSync(event.payload.canonicalPath, 'existing file blocks checkout')
      }
    },
  })
  await domain.dispatch({
    type: 'session.turn.start',
    commandId: 'failed-checkout',
    sessionId: DOMAIN_SESSION,
    turnId: 'failed-checkout-turn',
    message: { messageId: 'failed-checkout-message', role: 'user', text: 'hello', attachments: [] },
    bootstrap: {
      createSession: {
        worktreeTarget: {
          kind: 'new',
          worktreeId: managedId,
          baseWorktreeId: registration.worktreeId,
        },
        title: 'Blocked session',
        modelSelection: DOMAIN_MODEL,
      },
    },
  })
  await domain.engine.providerRuntimeIdle()
  unsubscribe()
  const snapshot = await refresh()
  expect(snapshot.worktrees.find((row) => row.id === managedId)?.lifecycle.state).toBe(
    'creation-failed',
  )
  expect(await navigation.openWorkspace({ environmentId, path: 'main' })).toEqual({
    status: 'applied',
  })
  expect(
    await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' }),
  ).toEqual({ status: 'applied' })
  expect(editor.workspaceStore.getState().rootFolder?.path).toBe('main')
  expect(navigation.router.history.location.pathname).toContain(`/chat/t/${DOMAIN_SESSION}`)
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    kind: 'session',
    sessionId: DOMAIN_SESSION,
  })
  const href = navigation.router.history.location.href
  await navigation.setMode('workbench')
  await pressBack(navigation)
  expect(navigation.router.history.location.href).toBe(href)
  expect(editor.workspaceStore.getState().rootFolder?.path).toBe('main')
})

test('a superseded ownership read aborts without publishing its session or replacing the new draft', async () => {
  const started = Promise.withResolvers<Request>()
  const released = Promise.withResolvers<void>()
  const ended = Promise.withResolvers<void>()
  let blockShell = false
  const fixture = await createChatNavigationFixture({
    beforeRequest: async (request) => {
      if (!blockShell || new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
      started.resolve(request)
      try {
        await released.promise
        request.signal.throwIfAborted()
      } finally {
        ended.resolve()
      }
    },
  })
  const { domain, environmentId, navigation, registration } = fixture
  const project = { environmentId, projectId: registration.projectId }
  await navigation.startDraft(project, registration.worktreeId)
  await domain.createSession(registration.worktreeId)
  blockShell = true
  const pending = navigation.openChat({
    ...project,
    sessionId: DOMAIN_SESSION,
    surface: 'main',
    replace: true,
  })
  try {
    const request = await started.promise
    expect(await navigation.startDraft(project, registration.worktreeId)).toEqual({
      status: 'applied',
    })
    expect(await pending).toEqual({ status: 'superseded' })
    expect(request.signal.aborted).toBe(true)
  } finally {
    released.resolve()
  }
  await ended.promise
  expect(
    selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId).sessionById[
      DOMAIN_SESSION
    ],
  ).toBeUndefined()
  expect(navigation.currentAddress().document).toBe('t/new')
})
