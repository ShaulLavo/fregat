import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { orchestrationForApp, runGit } from 'server/testing'
import type { SessionId } from '@workspace/contracts'
import { renderChatDraft } from '../../../../test/factories/chat-view'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { WorktreeManager } from '@/features/chat-mode/components/worktree-manager'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { createWorktreeLifecycleHarness } from '../../../../test/factories/worktree-lifecycle'
import { renderRailHarness } from '../../../../test/factories/rail-harness'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { holdToConfirm } from '../../../../test/hold'

test('draft choices, shared chips and dirty worktree cleanup survive deletion and restart', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const base = await harness.worktree()
  const project = (await harness.refresh()).projects.find(
    (project) => project.id === harness.projectId,
  )!
  const draftTarget = {
    environmentId: harness.environmentId,
    draftKey: '1be91a27-21da-4f7c-b345-6f6f09814671',
    rootPath: base.path,
  }
  const drafts = useChatInputDraftStore.getState()
  drafts.setPrompt(draftTarget, 'Keep this in the current checkout')
  drafts.setModelSelection(draftTarget, {
    model: 'mock-model',
    providerInstanceId: server.providerAdapter.adapterKey,
  })
  let created: SessionId | null = null
  const draft = renderChatDraft({
    draftId: draftTarget.draftKey,
    disabled: false,
    transport: harness.context.transport,
    project,
    worktree: base,
    rootPath: base.path,
    onSessionCreated: (id) => {
      created = id
    },
  })
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
    'Keep this in the current checkout',
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(created).not.toBeNull())
  const currentId = created
  expect(
    (await harness.refresh()).sessions.find((session) => session.id === currentId)?.worktreeId,
  ).toBe(base.id)
  draft.unmount()
  created = null
  const releaseCommit = (
    await runGit(base.canonicalPath, ['rev-parse', 'HEAD'], { cwdMode: 'option' })
  ).stdout.trim()
  await runGit(base.canonicalPath, ['branch', 'release'], { cwdMode: 'option' })
  await runGit(base.canonicalPath, ['commit', '--allow-empty', '-m', 'main moves on'], {
    cwdMode: 'option',
  })
  drafts.setPrompt(draftTarget, 'Create a separate checkout')
  drafts.setModelSelection(draftTarget, {
    model: 'mock-model',
    providerInstanceId: server.providerAdapter.adapterKey,
  })
  const isolatedDraft = renderChatDraft({
    draftId: draftTarget.draftKey,
    disabled: false,
    transport: harness.context.transport,
    project,
    worktree: base,
    rootPath: base.path,
    onSessionCreated: (id) => {
      created = id
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'New worktree' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Start from branch' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'release' }))
  expect(screen.getByRole('button', { name: 'Start from branch' })).toHaveTextContent(
    'From release',
  )
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
    'Create a separate checkout',
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(created).not.toBeNull())
  await orchestrationForApp(server.app).providerRuntimeIdle()
  const managedId = (await harness.refresh()).sessions.find(
    (session) => session.id === created,
  )!.worktreeId
  let managed = await harness.worktree(managedId)
  expect(managed.lifecycle.state).toBe('ready')
  expect(managed.id).not.toBe(base.id)
  expect(managed.baseCommit).toBe(releaseCommit)
  isolatedDraft.unmount()
  const sharedSession = await harness.create({ kind: 'current', worktreeId: managedId })
  const rail = renderRailHarness(harness)
  expect(rail.container.querySelectorAll(`[data-worktree-id="${managedId}"]`)).toHaveLength(2)
  rail.unmount()
  await harness.dispatch({
    type: 'session.delete',
    commandId: 'delete-managed-first',
    sessionId: created,
  })
  expect((await harness.worktree(managedId)).cleanupEligibility.reason).toBe('referenced')
  await harness.dispatch({
    type: 'session.delete',
    commandId: 'delete-managed-last',
    sessionId: sharedSession,
  })
  managed = await harness.worktree(managedId)
  await writeFile(path.join(managed.canonicalPath, 'file.txt'), 'Keep my changes\n')
  await writeFile(path.join(managed.canonicalPath, 'ignored.txt'), 'First ignored content\n')
  await harness.dispatch({
    type: 'worktree.cleanup',
    commandId: 'dirty-safe-cleanup',
    worktreeId: managedId,
  })
  expect((await harness.worktree(managedId)).lifecycle.state).toBe('cleanup-blocked')
  await server.restart()
  useChatProjectionStore.getState().resetChatProjection()
  await harness.refresh()
  useWorktreeManagerStore.getState().openManager(harness.projectRef)
  const manager = renderWithProviders(<WorktreeManager />)
  expect(await screen.findByText('Working changes retained')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes…' }))
  const confirmation = await screen.findByRole('dialog', { name: 'Discard changes and remove' })
  await writeFile(path.join(managed.canonicalPath, 'ignored.txt'), 'Changed after confirmation\n')
  holdToConfirm(within(confirmation).getByRole('button', { name: 'Discard changes and remove' }))
  await waitFor(async () => {
    const next = await harness.worktree(managedId)
    expect(next.lifecycle).toMatchObject({
      state: 'cleanup-blocked',
      reason: 'needs-reconfirmation',
    })
  })
  expect(await screen.findByText('Changes need a new confirmation')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes…' }))
  const renewed = await screen.findByRole('dialog', { name: 'Discard changes and remove' })
  holdToConfirm(within(renewed).getByRole('button', { name: 'Discard changes and remove' }))
  await waitFor(async () =>
    expect((await harness.worktree(managedId)).lifecycle).toEqual({
      state: 'removed',
      operationId: expect.any(String),
      removedAt: expect.any(String),
    }),
  )
  expect(
    (
      await runGit(harness.repository, ['show-ref', '--verify', `refs/heads/${managed.branch}`], {
        cwdMode: 'option',
      })
    ).stdout.trim(),
  ).toContain(managed.baseCommit)
  await act(async () => useWorktreeManagerStore.getState().closeManager())
  manager.unmount()
}, 20_000)

test('failed and missing zero-session checkouts remain actionable in the manager after restart', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const target = newWorktreeTarget(harness.worktreeId)
  const sessionId = await harness.create(target)
  const managed = await harness.worktree(target.worktreeId)
  await harness.dispatch({ type: 'session.delete', commandId: 'delete-for-recovery', sessionId })
  await runGit(
    harness.repository,
    ['worktree', 'lock', '--reason', 'Test cleanup failure', managed.canonicalPath],
    { cwdMode: 'option' },
  )
  await harness.dispatch({
    type: 'worktree.cleanup',
    commandId: 'locked-cleanup',
    worktreeId: managed.id,
  })
  expect((await harness.worktree(managed.id)).lifecycle.state).toBe('cleanup-failed')
  await server.restart()
  useChatProjectionStore.getState().resetChatProjection()
  await harness.refresh()
  useWorktreeManagerStore.getState().openManager(harness.projectRef)
  const manager = renderWithProviders(<WorktreeManager />)
  expect(await screen.findByText('Cleanup failed')).toBeInTheDocument()
  await runGit(harness.repository, ['worktree', 'unlock', managed.canonicalPath], {
    cwdMode: 'option',
  })
  await userEvent.click(screen.getByRole('button', { name: 'Retain checkout' }))
  await waitFor(async () =>
    expect((await harness.worktree(managed.id)).lifecycle.state).toBe('ready'),
  )
  manager.unmount()
  await runGit(harness.repository, ['worktree', 'remove', managed.canonicalPath], {
    cwdMode: 'option',
  })
  await server.restart()
  useChatProjectionStore.getState().resetChatProjection()
  await harness.refresh()
  const missingManager = renderWithProviders(<WorktreeManager />)
  expect(await screen.findByText('Checkout missing')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Resolve missing checkout…' }))
  const confirmation = await screen.findByRole('dialog', { name: 'Confirm checkout is absent' })
  expect(within(confirmation).getByText(/No files will be deleted/)).toBeInTheDocument()
  await userEvent.click(
    within(confirmation).getByRole('button', { name: 'Confirm checkout is absent' }),
  )
  await waitFor(async () =>
    expect((await harness.worktree(managed.id)).lifecycle.state).toBe('removed'),
  )
  await act(async () => useWorktreeManagerStore.getState().closeManager())
  missingManager.unmount()
}, 20_000)

test('Retry safely removes a previously dirty checkout once its changes are resolved', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const target = newWorktreeTarget(harness.worktreeId)
  const sessionId = await harness.create(target)
  const managed = await harness.worktree(target.worktreeId)
  await harness.dispatch({
    type: 'session.delete',
    commandId: 'delete-for-cleanup-retry',
    sessionId,
  })
  await writeFile(path.join(managed.canonicalPath, 'file.txt'), 'Changes to retain\n')
  await harness.dispatch({
    type: 'worktree.cleanup',
    commandId: 'block-before-cleanup-retry',
    worktreeId: managed.id,
  })
  expect((await harness.worktree(managed.id)).lifecycle).toMatchObject({
    state: 'cleanup-blocked',
    reason: 'dirty',
  })
  await writeFile(path.join(managed.canonicalPath, 'file.txt'), 'Initial content\n')
  useWorktreeManagerStore.getState().openManager(harness.projectRef)
  const manager = renderWithProviders(<WorktreeManager />)
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(async () =>
    expect((await harness.worktree(managed.id)).lifecycle.state).toBe('removed'),
  )
  expect(
    await screen.findByText('Checkout removed. Its branch and commits were retained.'),
  ).toBeInTheDocument()
  await act(async () => useWorktreeManagerStore.getState().closeManager())
  manager.unmount()
}, 20_000)
