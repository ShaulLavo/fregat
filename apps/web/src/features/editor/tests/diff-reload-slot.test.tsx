import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactElement } from 'react'
import { DiffView } from '@/features/git/components/diff-view'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { prepareGitReload } from '@/features/git/state/reload'
import { checkpointTurnDocument } from '@/lib/checkpoint-diff-query'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { documentTab } from '@/lib/documents/utils/tabs'
import { tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import type { TabId } from '@/lib/documents/utils/types'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { checkpointTurn } from '../../../../test/factories/checkpoint-turn'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { observeDiffEditors } from '../../../../test/factories/diff-attachment'
import { testDiffLanguageHost } from '../../../../test/factories/diff-language-host'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

const TEXT =
  Array.from(
    { length: 80 },
    (_, index) => `export const retained${index + 1} = "${'x'.repeat(80)}"`,
  ).join('\n') + '\n'

async function reloadHarness(
  client: Parameters<typeof checkpointTurn>[0],
  server: Parameters<typeof checkpointTurn>[1],
) {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const h = await checkpointTurn(client, server, [TEXT, 'after\n'])
  const runtime = h.application.getSnapshot().editor
  const root = workspaceRoot(runtime.workspaceStore.getState().rootFolder!.path)
  const comparison = checkpointTurnDocument(h.summary, root, false)
  const queries = runtime.queryClient
  const storage = environmentWindowStorage(runtime.storage.environmentId)
  const observed = observeDiffEditors()
  const writes: string[] = []
  const setItem = vi.spyOn(sessionStorage, 'setItem')
  setItem.mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.endsWith('git.view.v1')) writes.push(value)
    return Storage.prototype.setItem.call(this, key, value)
  })
  await queries.query(snapshotComparisonQueryOptions(comparison.source))
  prepareGitReload(queries, storage, root)

  function view(application: typeof h.application, id: TabId): ReactElement {
    return (
      <EditorStateProvider runtime={application.getSnapshot().editor}>
        <DiffView
          comparison={comparison.source}
          rootPath={root}
          languageHost={testDiffLanguageHost}
          tabId={id}
        />
      </EditorStateProvider>
    )
  }
  async function open(application: typeof h.application, id: TabId) {
    application.getSnapshot().editor.editorActivation.activate(documentTab(comparison), id)
    const rendered = renderWithProviders(view(application, id), {
      application,
      queryClient: queries,
    })
    await waitFor(() =>
      expect(observed.read('stacked').editor.materializeFullText()).toContain('retained80'),
    )
    await waitFor(() => expect(rendered.container.querySelector('[aria-busy="true"]')).toBeNull())
    return rendered
  }
  return { h, root, comparison, queries, storage, observed, writes, view, open }
}

test('a saved diff place applies once per page load, so a second view of the same diff starts at the top', async ({
  client,
  server,
}) => {
  const f = await reloadHarness(client, server)
  const first = await f.open(f.h.application, tabId('first-view'))
  f.observed.read('stacked').editor.setScrollPosition({ top: 240, left: 40 })
  window.dispatchEvent(new Event('pagehide'))
  expect(f.writes.length).toBeGreaterThan(0)
  first.unmount()

  await f.open(f.h.application, tabId('second-view'))
  expect(f.observed.read('stacked').editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
})

test('re-rendering a diff writes no reload record, and a reload never saves the patch-only phase over the full one', async ({
  client,
  server,
}) => {
  const f = await reloadHarness(client, server)
  const id = tabId('reload-writes')
  const first = await f.open(f.h.application, id)
  f.observed.read('stacked').editor.setScrollPosition({ top: 240, left: 40 })
  const offset = f.observed.read('stacked').editor.getScrollPosition()
  window.dispatchEvent(new Event('pagehide'))
  const settled = f.writes.length
  for (let index = 0; index < 5; index += 1) first.rerender(f.view(f.h.application, id))
  expect(f.writes.length).toBe(settled)
  first.unmount()
  f.h.application.dispose()
  f.queries.clear()

  const fresh = createTestApplicationRuntime()
  await f.queries.query(snapshotComparisonQueryOptions(f.comparison.source))
  prepareGitReload(f.queries, f.storage, f.root)
  f.writes.length = 0
  const reloaded = await f.open(fresh, id)
  expect(f.observed.read('stacked').editor.getScrollPosition()).toEqual(offset)
  window.dispatchEvent(new Event('pagehide'))
  expect(f.writes.filter((record) => record.includes('partial'))).toEqual([])
  reloaded.unmount()
  fresh.dispose()
})
