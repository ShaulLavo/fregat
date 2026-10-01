import { expect, test } from '../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../test/render'
import { TestEditorStateProvider } from '../../test/factories/editor-state-provider'
import { settingsSnapshot } from '../../test/factories/settings'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { AppShell } from '@/components/app-shell'

test('app shell clears busy state when workspace restoration settles', async ({ client }) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } } },
      values: { 'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } } },
    }),
  )
  const rendered = renderWithProviders(
    <TestEditorStateProvider>
      <AppShell dirtyTabCloseDialog={null} restoringWorkspace={true} />
    </TestEditorStateProvider>,
    { queryClient },
  )
  const shell = rendered.getByRole('main').closest('[aria-busy]')
  expect(shell?.getAttribute('aria-busy')).toBe('true')

  rendered.rerender(
    <TestEditorStateProvider>
      <AppShell dirtyTabCloseDialog={null} restoringWorkspace={false} />
    </TestEditorStateProvider>,
  )
  expect(shell?.getAttribute('aria-busy')).toBe('false')
  rendered.unmount()
  rendered.queryClient.clear()
})
