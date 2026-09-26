import { act, screen, waitFor } from '@testing-library/react'
import { CommitDetails } from '@/features/git/components/commit-details'
import { commitDetailsQueryOptions } from '@/features/git/utils/history-query'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { historyRepository } from '../../../../test/factories/git-history'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { installTestClient } from '../../../../test/factories/client-binding'
import { createObservedInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

test('commit details retain their hash and files until the selected commit can paint', async ({
  server,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('first.txt', 'first\n')
  const first = repo.commit('First subject')
  await repo.write('second.txt', 'second\n')
  const second = repo.commit('Second subject')
  const gate = createRequestGate(
    (request) => new URL(request.url).searchParams.get('commit') === second,
  )
  const restore = installTestClient(createObservedInProcessClient(server, gate.beforeRequest))
  const queryClient = createTestQueryClient()
  try {
    await queryClient.query(commitDetailsQueryOptions('history-repo', first))
    const rendered = renderWithProviders(
      <TestEditorStateProvider>
        <CommitDetails
          rootPath='history-repo'
          commit={first}
          onClose={() => {}}
          onOpen={() => {}}
        />
      </TestEditorStateProvider>,
      { queryClient },
    )
    await screen.findByText('first.txt')
    rendered.rerender(
      <TestEditorStateProvider>
        <CommitDetails
          rootPath='history-repo'
          commit={second}
          onClose={() => {}}
          onOpen={() => {}}
        />
      </TestEditorStateProvider>,
    )
    await gate.entered
    expect(screen.getByRole('button', { name: 'Commit information' })).toHaveAttribute(
      'title',
      first,
    )
    expect(screen.getByText('first.txt')).toBeVisible()
    expect(screen.queryByRole('status', { name: 'Loading commit details' })).toBeNull()
    expect(screen.getByRole('status', { name: 'Loading selected commit' })).toBeVisible()
    await act(async () => gate.release())
    await screen.findByText('second.txt')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Commit information' })).toHaveAttribute(
        'title',
        second,
      ),
    )
    expect(screen.queryByText('first.txt')).toBeNull()
    rendered.unmount()
  } finally {
    gate.release()
    queryClient.clear()
    restore()
  }
})
