import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ToolPaneHeader } from '@/components/tool-pane-header'
import { PaneHostContext, type PaneHost } from '@/providers/pane-host-context'
import { chatModeToolTabLabel } from '@/features/chat-mode/utils/panels'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test.each(['files', 'git', 'logs', 'problems', 'search', 'terminal'] as const)(
  'uses the chat rail label in the %s tool header',
  (tab) => {
    renderWithProviders(
      <EditorWorkspaceStateContext value={createEditorWorkspaceStore()}>
        <ToolPaneHeader tab={tab} />
      </EditorWorkspaceStateContext>,
    )

    expect(screen.getByText(chatModeToolTabLabel(tab))).toBeInTheDocument()
  },
)

function hostWithHide(onHide: () => void): PaneHost {
  return {
    activeView: 'terminal',
    hide: onHide,
    kind: 'workbench-bottom',
    views: [{ label: 'Terminal', select: () => {}, toggle: () => {}, value: 'terminal' }],
    visible: true,
  }
}

test('a header inside a pane host offers Hide for that host', async () => {
  let hidden = 0
  renderWithProviders(
    <EditorWorkspaceStateContext value={createEditorWorkspaceStore()}>
      <PaneHostContext value={hostWithHide(() => (hidden += 1))}>
        <ToolPaneHeader tab='terminal' />
      </PaneHostContext>
    </EditorWorkspaceStateContext>,
  )

  fireEvent.contextMenu(screen.getByText('Terminal'))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide Terminal' }))

  expect(hidden).toBe(1)
})

test('a header outside every host has no pane menu', () => {
  renderWithProviders(
    <EditorWorkspaceStateContext value={createEditorWorkspaceStore()}>
      <ToolPaneHeader tab='terminal' />
    </EditorWorkspaceStateContext>,
  )

  fireEvent.contextMenu(screen.getByText('Terminal'))

  expect(screen.queryByRole('menuitem', { name: 'Hide Terminal' })).not.toBeInTheDocument()
})
