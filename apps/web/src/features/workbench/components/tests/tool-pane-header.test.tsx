import { screen } from '@testing-library/react'

import { ToolPaneHeader } from '@/components/tool-pane-header'
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
