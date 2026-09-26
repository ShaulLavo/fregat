import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { checkpointIntentOptions } from '@/lib/checkpoint-intent'
import {
  registerEnvironmentQueryClient,
  originForQueryClient,
} from '@/lib/environments/state/query-clients'
import { createObservedInProcessClient } from '../../../../../test/client'
import { CheckpointOpen } from '../../../../../test/factories/checkpoint-open'
import { checkpointTurn } from '../../../../../test/factories/checkpoint-turn'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

for (const { input, leave } of [
  { input: 'keyboard', leave: 'unmount' },
  { input: 'keyboard', leave: 'cursor movement' },
  { input: 'click', leave: 'unmount' },
] as const) {
  test(`${input} checkpoint open reuses loaded turn data across ${leave}`, async ({
    client,
    server,
  }) => {
    const h = await checkpointTurn(client, server)
    const requests: Request[] = []
    const observed = createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname !== '/orchestration/turn-diff') return
      requests.push(request)
    })
    const queryClient = createTestQueryClient()
    registerEnvironmentQueryClient(queryClient, originForQueryClient(queryClient), observed)
    let result: Promise<unknown> | undefined
    const onOpen = (opening: Promise<boolean>) => {
      result = opening.catch((error: unknown) => error)
    }
    const view = (visible: boolean) => (
      <EditorStateProvider runtime={h.application.getSnapshot().editor}>
        <CheckpointOpen summary={h.summary} visible={visible} onOpen={onOpen} />
      </EditorStateProvider>
    )
    const rendered = renderWithProviders(view(true), {
      application: h.application,
      queryClient,
      command: { bindings: [] },
    })
    try {
      const tree = await screen.findByRole('tree', { name: 'Turn changed files' })
      await screen.findByRole('treeitem', { name: /app.txt/ })
      act(() => tree.focus())
      await userEvent.keyboard('{Home}')
      const options = checkpointIntentOptions(h.summary)!
      await waitFor(() =>
        expect(queryClient.getQueryState(options.queryKey)?.status).toBe('success'),
      )
      await waitFor(() => expect(requests).toHaveLength(1))
      if (input === 'keyboard') await userEvent.keyboard('{Enter}')
      else await userEvent.click(screen.getByRole('treeitem', { name: /app.txt/ }))
      expect(result).toBeDefined()
      if (leave === 'unmount') rendered.rerender(view(false))
      else await userEvent.keyboard('{ArrowDown}')
      await act(async () => {
        expect(await result).toBe(true)
      })
      expect(requests).toHaveLength(1)
      expect(queryClient.getQueryData(options.queryKey)).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'app.txt' })]),
      )
      expect(
        h.application.getSnapshot().editor.workspaceStore.getState().selectedTabContent,
      ).toMatchObject({
        kind: 'document',
        document: {
          kind: 'git-diff',
          source: { kind: 'checkpoint-file', file: { path: 'app.txt' } },
        },
      })
    } finally {
      await result
      rendered.unmount()
      queryClient.clear()
    }
  })
}
