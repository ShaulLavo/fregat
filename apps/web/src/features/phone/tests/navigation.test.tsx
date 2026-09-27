import { afterEach } from 'vitest'

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { filesystemPath } from '@/lib/documents/utils/identity'
import { settingsTab } from '@/lib/documents/utils/tabs'
import { rememberDeskMode, takeDeskMode, useShellStore } from '@/lib/shell/state/store'
import { phoneLevel } from '@/features/phone/utils/level'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import { DOMAIN_SESSION } from '../../../../test/factories/session-domain'
import { pressBack } from '../../../../test/address'

afterEach(() => useShellStore.setState({ kind: 'workbench', phoneScreen: null, deskMode: null }))

function shownLevel() {
  const selection = useSessionSelectionStore.getState().selection.kind
  return phoneLevel(selection, useShellStore.getState().phoneScreen)
}

test('the phone stack pushes each screen onto the history and Back pops them in order', async () => {
  useShellStore.setState({ kind: 'phone' })
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await refresh()
  await navigation.showPhoneSessions()
  expect(useSessionSelectionStore.getState().selection.kind).toBe('auto')

  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  await navigation.showPhoneScreen('changes')
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })
  expect(useShellStore.getState().phoneScreen).toBe('file')
  expect(navigation.router.history.location.href).toContain('screen=file')

  await pressBack(navigation)
  expect(useShellStore.getState().phoneScreen).toBe('changes')
  await pressBack(navigation)
  expect(useShellStore.getState().phoneScreen).toBeNull()
  expect(useSessionSelectionStore.getState().selection).toMatchObject({ sessionId: DOMAIN_SESSION })
  await pressBack(navigation)
  expect(useSessionSelectionStore.getState().selection.kind).toBe('auto')
})

test('the workbench never writes a phone screen into its address', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await refresh()
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  await navigation.openFile({ owner: editor.workspaceStore, path: filesystemPath('main/keep.txt') })

  expect(navigation.router.history.location.href).not.toContain('screen=')
})

test('settings opened from the session list shows over it, and Back returns to the list', async () => {
  useShellStore.setState({ kind: 'phone' })
  const { editor, navigation } = await createChatNavigationFixture()
  await navigation.showPhoneSessions()
  expect(shownLevel()).toBe('sessions')

  await navigation.openContent({ owner: editor.workspaceStore, content: settingsTab() })
  expect(shownLevel()).toBe('file')

  await pressBack(navigation)
  expect(shownLevel()).toBe('sessions')
})

test('stepping between files replaces the entry, so one Back leaves the file screen', async () => {
  useShellStore.setState({ kind: 'phone' })
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  for (const name of ['b.txt', 'c.txt']) writeFileSync(path.join(domain.main, name), name)
  await refresh()
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  await navigation.showPhoneScreen('changes')
  const owner = editor.workspaceStore
  await navigation.openFile({ owner, path: filesystemPath('main/keep.txt') })
  await navigation.openFile({ owner, path: filesystemPath('main/b.txt'), replace: true })
  await navigation.openFile({ owner, path: filesystemPath('main/c.txt'), replace: true })
  expect(shownLevel()).toBe('file')

  await pressBack(navigation)
  expect(shownLevel()).toBe('changes')
})

test('a window widened out of the phone shell gets its desk mode back in place', async () => {
  const { domain, editor, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await refresh()
  await navigation.setMode('workbench')
  useShellStore.setState({ kind: 'phone' })
  rememberDeskMode(editor.workspaceStore.getState().uiMode)
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  expect(editor.workspaceStore.getState().uiMode).toBe('chat')

  useShellStore.setState({ kind: 'workbench' })
  const index = navigation.historyIndex()
  await navigation.setMode(takeDeskMode() ?? 'chat', undefined, true)
  expect(editor.workspaceStore.getState().uiMode).toBe('workbench')
  expect(navigation.historyIndex()).toBe(index)
  expect(takeDeskMode()).toBeNull()
})
