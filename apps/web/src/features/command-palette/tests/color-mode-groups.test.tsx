import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { ColorModeGroups } from '@/features/command-palette/components/color-mode-groups'
import { colorModeItemForValue } from '@/features/command-palette/utils/query'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { Command } from '@workspace/ui/components/command'
import type { ReactNode } from 'react'

test('rows carry the value the preview path reads back', () => {
  const actions = commandPaletteActions()

  render(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorModeGroups currentTheme='light' />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  // Preview runs off the highlighted row's value so the keyboard previews too;
  // the row value has to resolve back to the mode it stands for.
  const row = screen.getByText('Dark').closest('[cmdk-item]')

  expect(colorModeItemForValue(row?.getAttribute('data-value') ?? '')?.command).toBe(
    'workspace.setDarkTheme',
  )
})

function CommandPaletteActionsProvider({
  actions,
  children,
}: {
  readonly actions: CommandPaletteActions
  readonly children: ReactNode
}) {
  return <CommandPaletteActionsContext value={actions}>{children}</CommandPaletteActionsContext>
}

function commandPaletteActions(): CommandPaletteActions {
  return {
    disabledReasonForCommand: vi.fn(() => null),
    previewColorTheme: vi.fn(),
    selectColorTheme: vi.fn(),
    selectContent: () => Promise.resolve(),
    selectFile: vi.fn(),
    selectPlatformCommand: vi.fn(),
    selectScript: vi.fn(),
    selectSession: vi.fn(),
    selectGotoLine: vi.fn(),
    selectSymbol: vi.fn(),
    startSessionDraft: vi.fn(),
  }
}
