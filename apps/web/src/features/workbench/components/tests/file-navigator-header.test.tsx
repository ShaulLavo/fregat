import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FileNavigatorHeader } from '@/features/workbench/components/file-navigator-header'
import { createNavigatorHeaderStore } from '@/features/workbench/state/navigator-header-store'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { treeModel } from '@/lib/tree-model'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const ROOT = filesystemPath('/work/project')

function renderHeader() {
  const header = createNavigatorHeaderStore()
  const view = renderWithProviders(
    <EditorWorkspaceStateContext value={createEditorWorkspaceStore()}>
      <FileNavigatorHeader
        headerStore={header.store}
        loading={false}
        rootPath={ROOT}
        treeState={{ status: 'ready', data: treeModel({ entries: [], path: ROOT }, ROOT) }}
      />
    </EditorWorkspaceStateContext>,
  )
  return { header, view }
}

test('the toolbar follows what the tree publishes', async () => {
  const { header } = renderHeader()
  const newFile = screen.getByRole('button', { name: 'New file at workspace root' })
  expect(newFile).toHaveAttribute('aria-disabled', 'true')

  let created = 0
  act(() =>
    header.publishToolbar({
      createFile: () => void (created += 1),
      createFolder: () => {},
      mutationsEnabled: true,
      revealActiveFile: () => {},
    }),
  )

  expect(newFile).not.toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(newFile)
  expect(created).toBe(1)
})

test('shows a visible count only when it was published for the shown root', () => {
  const { header, view } = renderHeader()
  const empty = view.container.innerHTML

  act(() => header.setVisibleCount('/work/other', 12))
  expect(view.container.innerHTML).toBe(empty)

  act(() => header.setVisibleCount(ROOT, 12))
  expect(view.container.innerHTML).not.toBe(empty)
})
