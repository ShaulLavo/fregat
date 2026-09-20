import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { ColorThemeGroups } from '@/features/command-palette/components/color-theme-groups'
import { colorThemeIdFromItemValue } from '@/features/command-palette/utils/query'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { Command } from '@workspace/ui/components/command'

test('lists code themes for the current light or dark mode', () => {
  const actions = commandPaletteActions()

  renderWithProviders(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorThemeGroups />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  expect(screen.getByText('Code theme for dark mode')).toBeInTheDocument()
  expect(screen.queryByText('Code theme for light mode')).not.toBeInTheDocument()
  expect(screen.getByText('Monokai')).toBeInTheDocument()
  expect(screen.queryByText('GitHub Light')).not.toBeInTheDocument()
})

test('offers the built-in tree-sitter palettes ahead of the VSCode themes', () => {
  const actions = commandPaletteActions()

  renderWithProviders(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorThemeGroups />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  const darkGroup = screen.getByText('Code theme for dark mode').closest('[cmdk-group]')
  const rows = darkGroup?.querySelectorAll('[cmdk-item]') ?? []

  expect(screen.getByText('Native Dark')).toBeInTheDocument()
  expect(screen.queryByText('Native Light')).not.toBeInTheDocument()
  expect(rows[0]?.textContent).toContain('Native Dark')
})

test('marks the selected theme of the active color mode as active', () => {
  const actions = commandPaletteActions()

  renderWithProviders(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorThemeGroups />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  // renderWithProviders defaults to dark mode, whose default theme is dark-plus.
  const activeBadge = screen.getByText('active')
  expect(activeBadge.closest('[cmdk-item]')).toBe(
    screen.getByText('Dark Plus').closest('[cmdk-item]'),
  )
})

test('applies the chosen theme on select', async () => {
  const user = userEvent.setup()
  const actions = commandPaletteActions()

  renderWithProviders(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorThemeGroups />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  await user.click(screen.getByText('Monokai'))

  expect(actions.selectColorTheme).toHaveBeenCalledWith('monokai')
})

test('rows carry the value the preview path reads back', () => {
  const actions = commandPaletteActions()

  renderWithProviders(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <ColorThemeGroups />
      </Command>
    </CommandPaletteActionsProvider>,
  )

  // Preview is driven by the highlighted row's value, not by pointer events —
  // that is what makes arrowing through the list preview like hovering does. So
  // the row value has to survive the round trip back to a theme id.
  const row = screen.getByText('Monokai').closest('[cmdk-item]')
  const value = row?.getAttribute('data-value') ?? ''

  expect(colorThemeIdFromItemValue(value)).toBe('monokai')
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
