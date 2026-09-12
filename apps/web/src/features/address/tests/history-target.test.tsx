import { filesystemPath } from '@/lib/documents/utils/identity'
import { testNullableTabContent } from '../../../../test/factories/document-targets'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import { AMBIGUOUS_SESSION, DOMAIN_SESSION } from '../../../../test/factories/session-domain'
import { pressBack } from '../../../../test/address'

test('deleting a hidden sidebar destination replaces its history target with the successor', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  writeFileSync(path.join(domain.main, 'other.txt'), 'other file')
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'sidebar' })
  await navigation.setSidePanel('files')
  await domain.dispatch({
    type: 'session.delete',
    commandId: 'delete-hidden-sidebar-destination',
    sessionId: DOMAIN_SESSION,
  })
  await refresh()
  await navigation.reconcileSessions({
    environmentId,
    projectId: registration.projectId,
    removedSessionIds: [DOMAIN_SESSION],
    successorSessionId: AMBIGUOUS_SESSION,
  })
  await navigation.openFile({
    owner: editor.workspaceStore,
    path: filesystemPath('main/other.txt'),
  })
  await navigation.setSidePanel('logs')
  await pressBack(navigation)
  expect(navigation.getSnapshot().status).toBe('applied')
  expect(editor.workspaceStore.getState().workbenchPanels.activeSidebarTab).toBe('chat')
  expect(useSidebarSelectionStore.getState().selection).toMatchObject({
    sessionId: AMBIGUOUS_SESSION,
  })
})

test('explicitly reopening the same file replaces a sidebar conversation destination', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  writeFileSync(path.join(domain.main, 'other.txt'), 'other file')
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'sidebar' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  await navigation.openFile({
    owner: editor.workspaceStore,
    path: filesystemPath('main/other.txt'),
  })
  await navigation.setSidePanel('logs')
  await pressBack(navigation)
  expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
    testNullableTabContent('main/keep.txt'),
  )
  expect(editor.workspaceStore.getState().workbenchPanels.activeSidebarTab).toBe('logs')
})
