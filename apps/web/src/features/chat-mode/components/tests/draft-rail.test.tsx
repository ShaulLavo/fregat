import userEvent from '@testing-library/user-event'
import { screen, within, waitFor } from '@testing-library/react'
import { onTestFinished } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import {
  useChatInputDraftStore,
  hydrateChatInputDraftStoreFromStorage,
} from '@/features/chat/state/chat-input-draft-store'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'

test('draft options open with click and Enter while discarding another row preserves selection', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  hydrateChatInputDraftStoreFromStorage(environmentScopedStorage(harness.environmentId))
  const targets = [0, 1].map(() => ({
    environmentId: harness.environmentId,
    rootPath: harness.context.worktree!.path,
    draftKey: crypto.randomUUID(),
  }))
  const drafts = useChatInputDraftStore.getState()
  for (const [index, target] of targets.entries()) {
    drafts.setIdentity(target, {
      id: target.draftKey,
      projectId: harness.projectId,
      rootPath: target.rootPath,
      baseWorktreeId: harness.worktreeId,
      worktreeTarget: { kind: 'current', worktreeId: harness.worktreeId },
      createdAt: new Date(index * 1000).toISOString(),
    })
    drafts.setPrompt(target, `Recover message ${index}`)
  }
  onTestFinished(() => {
    for (const target of targets) useChatInputDraftStore.getState().clearDraft(target)
  })
  renderRailHarness(harness)
  const list = screen.getByRole('listbox', { name: 'Drafts' })
  const first = within(list).getByRole('option', { name: /Recover message 0/ })
  expect(first).toBeVisible()
  expect(first).toHaveAttribute('aria-selected', 'false')
  await userEvent.click(first)
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toMatchObject({
      kind: 'draft',
      draftId: targets[0]!.draftKey,
    }),
  )
  list.focus()
  await userEvent.keyboard('{Home}{Enter}')
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toMatchObject({
      kind: 'draft',
      draftId: targets[1]!.draftKey,
    }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discard draft: Recover message 0' }))
  await waitFor(() =>
    expect(within(list).queryByRole('option', { name: /Recover message 0/ })).toBeNull(),
  )
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    kind: 'draft',
    draftId: targets[1]!.draftKey,
  })
})
