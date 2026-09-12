import {
  jumpToSession,
  selectAdjacentSession,
  startScopedSessionDraft,
} from '@/features/chat-mode/state/session-commands'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import {
  SESSION_JUMP_POSITIONS,
  sessionJumpCommandId,
  type PlatformCommandId,
} from '@/keymap/types'
import { createRailHarness } from '../../../test/factories/rail-harness'
import { createWorktreeLifecycleHarness } from '../../../test/factories/worktree-lifecycle'
import { executeDomainGit } from '../../../test/factories/session-domain'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { waitForNavigation } from '../../../test/address'
import { getNavigation } from '@/state/navigation-binding'
test('every session command is reachable from the keyboard', () => {
  const bound = boundCommands()

  expect(bound.get('workspace.newSession')).toEqual(['Mod+Alt+N'])
  expect(bound.get('workspace.toggleSessionRail')).toEqual(['Mod+Alt+B'])
  expect(bound.get('workspace.previousSession')).toEqual(['Mod+Alt+['])
  expect(bound.get('workspace.nextSession')).toEqual(['Mod+Alt+]'])
  expect(
    SESSION_JUMP_POSITIONS.map((position) => bound.get(sessionJumpCommandId(position))),
  ).toEqual([
    ['Mod+Alt+1'],
    ['Mod+Alt+2'],
    ['Mod+Alt+3'],
    ['Mod+Alt+4'],
    ['Mod+Alt+5'],
    ['Mod+Alt+6'],
    ['Mod+Alt+7'],
    ['Mod+Alt+8'],
    ['Mod+Alt+9'],
  ])
})

test('jumping selects the requested scoped row only after its real root opens', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server, ['First', 'Second', 'Third'])
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  expect(await jumpToSession(2)).toBe(true)
  expect(selectedSessionId()).toBe(h.sessionIds[1])
  expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    h.context.worktree!.path,
  )
})
test('session navigation and new drafts accept the workspace root empty relative path', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server, [])
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  const registration = await h.dispatch(
    createProjectRegistrationCommand({ workspaceRoot: '', title: 'Workspace root' }),
  )
  const owner = registration.result!
  const submission = createDraftSessionSubmission({
    createdAt: '2026-09-06T10:00:00.000Z',
    worktreeTarget: { kind: 'current', worktreeId: owner.worktreeId },
    modelSelection: { model: 'mock-model', providerInstanceId: server.providerAdapter.adapterKey },
    text: 'Work at the workspace root',
  })
  await h.dispatch(submission.command)
  const snapshot = await h.refresh()
  expect(snapshot.worktrees.find((worktree) => worktree.id === owner.worktreeId)?.path).toBe('')
  useSessionRailStore.getState().setScope(owner.projectId)
  const opened = await jumpToSession(1)
  const selected = selectedSessionId()
  const drafted = await startScopedSessionDraft()
  expect({ opened, drafted }).toEqual({ opened: true, drafted: true })
  expect(selected).toBe(submission.command.sessionId)
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(owner.worktreeId)
  expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe('')
})
test('jumping past the end preserves selection', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  await jumpToSession(1)
  const selected = selectedSessionId()
  expect(await jumpToSession(3)).toBe(false)
  expect(selectedSessionId()).toBe(selected)
  expect(h.sessionIds).toContain(selected)
})
test('next and previous traverse the visible order and wrap', async ({ client, server }) => {
  const h = await createRailHarness(client, server, ['First', 'Second', 'Third'])
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  await jumpToSession(1)
  const first = selectedSessionId()
  await selectAdjacentSession('next')
  const second = selectedSessionId()
  expect(second).not.toBe(first)
  await selectAdjacentSession('previous')
  expect(selectedSessionId()).toBe(first)
  await selectAdjacentSession('previous')
  expect(selectedSessionId()).not.toBe(first)
  await selectAdjacentSession('next')
  expect(selectedSessionId()).toBe(first)
})
test('traversal uses the same filtered rows as the rail', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  useSessionRailStore.getState().setQuery('Second')
  expect(await jumpToSession(1)).toBe(true)
  expect(selectedSessionId()).toBe(h.sessionIds[1])
  await selectAdjacentSession('next')
  expect(selectedSessionId()).toBe(h.sessionIds[1])
})
test('new session uses the scoped project and leaves the archive view', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  useSessionRailStore.getState().setScope(h.projectId)
  useSessionRailStore.getState().setView('archived')
  expect(await startScopedSessionDraft()).toBe(true)
  expect(useSessionSelectionStore.getState().selection).toEqual({
    kind: 'draft',
    environmentId: h.environmentId,
    projectId: h.projectId,
  })
  expect(useSessionRailStore.getState().view).toBe('active')
})

test('an active-session draft preserves its missing checkout identity while opening the protected root', async ({
  client,
  server,
}) => {
  const h = await createWorktreeLifecycleHarness(client, server)
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  const target = newWorktreeTarget(h.worktreeId)
  const sessionId = await h.create(target)
  const worktree = await h.worktree(target.worktreeId)
  await executeDomainGit(h.repository, 'worktree', 'remove', worktree.canonicalPath)
  await server.restart()
  await h.refresh()
  expect((await h.worktree(target.worktreeId)).lifecycle.state).toBe('missing')
  useSessionSelectionStore.getState().selectSession(h.environmentId, h.projectId, sessionId)
  useSessionRailStore.getState().setScope(h.projectId)
  expect(await startScopedSessionDraft()).toBe(true)
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(target.worktreeId)
  expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    (await h.worktree()).path,
  )
})

test('new session uses the linked checkout of the session selected automatically by the stage', async ({
  client,
  server,
}) => {
  const h = await createWorktreeLifecycleHarness(client, server)
  renderWithProviders(<></>, { application: h.application })
  await waitForNavigation(getNavigation())
  const target = newWorktreeTarget(h.worktreeId)
  await h.create(target)
  useSessionRailStore.getState().setScope(h.projectId)
  expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
  expect(await startScopedSessionDraft()).toBe(true)
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(target.worktreeId)
  expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    (await h.worktree(target.worktreeId)).path,
  )
  expect(await startScopedSessionDraft()).toBe(true)
  expect(useSessionSelectionStore.getState().draftWorktreeId).toBe(target.worktreeId)
})
function selectedSessionId() {
  const { selection } = useSessionSelectionStore.getState()
  return selection.kind === 'session' ? selection.sessionId : null
}
function boundCommands() {
  const commands = new Map<PlatformCommandId, string[]>()
  for (const binding of defaultPlatformKeyBindings('mac')) {
    if (!binding.command) continue
    const keys = commands.get(binding.command) ?? []
    keys.push(binding.keys)
    commands.set(binding.command, keys)
  }
  return commands
}
