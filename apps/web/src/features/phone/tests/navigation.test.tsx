import { afterEach } from 'vitest'

import { filesystemPath } from '@/lib/documents/utils/identity'
import { useShellStore } from '@/lib/shell/state/store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import { DOMAIN_SESSION } from '../../../../test/factories/session-domain'
import { pressBack } from '../../../../test/address'

afterEach(() => useShellStore.setState({ kind: 'workbench', phoneScreen: null }))

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
