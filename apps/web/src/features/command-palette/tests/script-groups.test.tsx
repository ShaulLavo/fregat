import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { quickAccessMode, quickAccessQuery } from '@/features/command-palette/utils/query'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { ScriptGroups } from '@/features/command-palette/components/script-groups'
import type { ProjectScriptSuggestion } from '@/features/chat-mode/utils/project-scripts'
import { Command, CommandList } from '@workspace/ui/components/command'
import { expect, test } from '../../../../test/fixtures'

test('the run prefix puts the palette in script mode and is stripped from the query', () => {
  expect(quickAccessMode('run test')).toBe('scripts')
  expect(quickAccessQuery('run test')).toBe('test')
})

test('separates the project’s saved scripts from what the manifest offered', () => {
  renderScripts([
    { command: 'bun run dev', name: 'Start the app', saved: true },
    { command: 'bun run test', name: 'test', saved: false },
  ])

  expect(screen.getByText('Project Scripts')).toBeInTheDocument()
  expect(screen.getByText('From package.json')).toBeInTheDocument()
  expect(screen.getByText('Start the app')).toBeInTheDocument()
})

test('hands the picked script to the runner, command and all', async () => {
  const actions = renderScripts([{ command: 'bun run test', name: 'test', saved: false }])

  await userEvent.click(screen.getByText('test'))

  // The command, not the name: the terminal runs the one and the row only
  // labels it, and a runner handed a label would run nothing.
  expect(actions.selectScript).toHaveBeenCalledWith(
    expect.objectContaining({ command: 'bun run test' }),
  )
})

test('says a project has no scripts instead of showing an empty list', () => {
  renderScripts([])

  expect(screen.getByText('No scripts in this project.')).toBeInTheDocument()
})

function renderScripts(scripts: readonly ProjectScriptSuggestion[]) {
  const actions = commandPaletteActions()

  render(
    <CommandPaletteActionsProvider actions={actions}>
      <Command>
        <CommandList>
          <ScriptGroups scripts={scripts} />
        </CommandList>
      </Command>
    </CommandPaletteActionsProvider>,
  )

  return actions
}

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
