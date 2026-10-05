import { Button } from '@workspace/ui/components/button'
import { act, waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { historyRepository } from '../../../../test/factories/git-history'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import {
  seedWorkspaceCache,
  renderAddressHarness,
  waitForNavigation,
} from '../../../../test/address'
import { historicalDocument } from '@/lib/documents/utils/comparisons'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { documentTokenForContent } from '@/features/address/utils/document-token'
import { panelsForAddress } from '@/features/address/utils/cache'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { emptyAddress } from '@workspace/client-core/address/grammar'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { useOpenReviewSource } from '@/features/chat/hooks/use-open-review-source'
import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'
import { TEST_SESSION_ID } from '../../../../test/factories/chat'
import { activeServerOrigin } from '@/lib/client'
import { renderWithProviders } from '../../../../test/render'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'

function ReviewSource({ comment }: { readonly comment: SentReviewComment }) {
  const review = useOpenReviewSource(TEST_SESSION_ID)
  return (
    <Button onClick={() => review.mutate(comment)}>{review.data ?? 'Open quoted source'}</Button>
  )
}

test('a forged historical claim cannot select an existing valid subject or seed it at boot', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.ts', 'before\n')
  repo.commit('Before')
  await repo.write('a.ts', 'after\n')
  const id = repo.commit('After')
  const rootPath = filesystemPath('history-repo')
  const workspaceAddress = await registerTestWorkspaceAddress(client, rootPath)
  seedWorkspaceCache({ rootPath, workspaceAddress, tabPaths: ['history-repo/a.ts'] })
  const { navigation, harness } = await renderAddressHarness({
    initialEntries: [`/~${workspaceToken(workspaceAddress)}/workbench/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const details = (await client.git.history.commit.get({ query: { path: rootPath, commit: id } }))
    .data
  expect(details).not.toBeNull()
  if (!details?.files[0]) return
  const document = historicalDocument({ rootPath, details, file: details.files[0] })
  if (
    !document ||
    document.source.kind !== 'snapshot' ||
    document.source.target.kind !== 'historical'
  )
    return expect.unreachable('historical fixture has no target')
  expect(
    await navigation.openContent({ owner: harness.workspace, content: documentTab(document) }),
  ).toEqual({ status: 'applied' })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('history-repo/a.ts') })
  const before = harness.workspace.getState().selectedTabContent
  const target = document.source.target
  const forged = documentTab({
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      target: { ...target, revision: { ...target.revision, status: 'deleted' } },
    },
  })
  const token = documentTokenForContent(rootPath, forged)
  if (token.kind !== 'token') return expect.unreachable('forged fixture has no token')
  const panels = harness.workspace.getState().workbenchPanels
  expect(
    activeEditorTabForWorkbenchPanels(
      panelsForAddress(panels, rootPath, {
        ...emptyAddress(),
        mode: 'workbench',
        document: token.token,
      }),
    )?.content,
  ).toEqual(before)
  expect(await navigation.openContent({ owner: harness.workspace, content: forged })).toMatchObject(
    { status: 'unavailable' },
  )
  expect(harness.workspace.getState().selectedTabContent).toEqual(before)
  expect(
    await navigation.openContent({
      owner: harness.workspace,
      content: documentTab({
        ...document,
        source: { ...document.source, target: { ...target, rootPath: filesystemPath('other') } },
      }),
    }),
  ).toEqual({ status: 'superseded' })
  expect(harness.workspace.getState().selectedTabContent).toEqual(before)
})

test('the deleted review quote opener retains its fixed pair after the worktree recreates the file', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.ts', 'quoted line\n')
  repo.commit('Quoted version')
  const oldObjectId = repo.git('rev-parse', 'HEAD:a.ts')
  await repo.write('a.ts', 'different live line\n')
  const rootPath = filesystemPath('history-repo')
  const workspaceAddress = await registerTestWorkspaceAddress(client, rootPath)
  seedWorkspaceCache({ rootPath, workspaceAddress, tabPaths: ['history-repo/a.ts'] })
  const { application, navigation, harness } = await renderAddressHarness({
    initialEntries: [`/~${workspaceToken(workspaceAddress)}/workbench/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const transport = createChatTransport(activeServerOrigin())
  const comment: SentReviewComment = {
    author: 'user',
    body: 'Review the deleted line',
    quote: '```diff\n@@ -1 +0,0 @@\n-quoted line\n```',
    anchor: {
      kind: 'diff',
      path: 'history-repo/a.ts',
      oldObjectId,
      oldRange: { start: 1, end: 1 },
      newRange: null,
    },
  }
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <ChatTransportContext value={transport}>
        <ReviewSource comment={comment} />
      </ChatTransportContext>
    </TestEditorStateProvider>,
    { application, navigation, queryClient: application.getSnapshot().queryClient },
  )
  try {
    await act(async () => rendered.getByRole('button', { name: 'Open quoted source' }).click())
    await rendered.findByRole('button', { name: 'opened' })
    await waitFor(() =>
      expect(harness.workspace.getState().selectedTabContent).toMatchObject({
        kind: 'document',
        document: {
          kind: 'git-diff',
          source: {
            kind: 'snapshot',
            target: {
              kind: 'captured-review',
              rootPath,
              revision: {
                old: { kind: 'blob', objectId: oldObjectId },
                new: { kind: 'missing' },
                status: 'deleted',
              },
            },
          },
        },
      }),
    )
    const read = [...harness.documents.getState().snapshotComparisons.values()].find(
      (entry) => entry.kind === 'ready' && entry.input.comparison.target.kind === 'captured-review',
    )
    expect(read?.kind).toBe('ready')
    if (read?.kind === 'ready') {
      const file = read.input.files[0]
      expect(file?.kind).toBe('full')
      if (file?.kind === 'full')
        expect(file.old.kind === 'blob' && file.old.text).toBe('quoted line\n')
    }
  } finally {
    rendered.unmount()
    transport.close()
  }
})
