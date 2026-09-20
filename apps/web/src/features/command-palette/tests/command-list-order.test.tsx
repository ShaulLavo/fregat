import { Command, CommandInput, CommandList } from '@workspace/ui/components/command'

import { expect, test } from '../../../../test/fixtures'
import { render } from '@testing-library/react'

import { CommandGroups } from '@/features/command-palette/components/command-groups'
import {
  commandPaletteItems,
  groupedCommandItems,
  paletteOwnsItemOrder,
  quickAccessFilter,
} from '@/features/command-palette/utils/query'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { platformCommandSpecs } from '@/keymap/command-registry'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'

const RECENTS = ['workspace.showSettings', 'workspace.showChatMode'] as const
const COMMAND_PALETTE_ACTIONS: CommandPaletteActions = {
  disabledReasonForCommand: () => null,
  previewColorTheme: () => undefined,
  selectColorTheme: () => undefined,
  selectContent: () => Promise.resolve(),
  selectFile: () => Promise.resolve(),
  selectGotoLine: () => Promise.resolve(),
  selectPlatformCommand: () => Promise.resolve(),
  selectScript: () => Promise.resolve(),
  selectSession: () => Promise.resolve(),
  selectSymbol: () => Promise.resolve(),
  startSessionDraft: () => Promise.resolve(),
}

/**
 * cmdk re-sorts the rendered list by its own match score whenever it filters, so the
 * order React computed only survives if the palette turns that off. These render the
 * real list to assert the order the user actually sees, not the array we handed over.
 */
function renderCommandList(search: string, shouldFilter: boolean) {
  const items = commandPaletteItems(platformCommandSpecs, defaultPlatformKeyBindings('linux'))
  const view = render(
    <Command filter={quickAccessFilter} shouldFilter={shouldFilter}>
      {/* The input is what puts the query into cmdk's own state, and cmdk only
          re-sorts while that state is non-empty — without it the control below
          would pass for the wrong reason. */}
      <CommandInput value={search} onValueChange={() => {}} />
      <CommandList>
        <CommandPaletteActionsContext value={COMMAND_PALETTE_ACTIONS}>
          <CommandGroups groups={groupedCommandItems(items, search, RECENTS)} />
        </CommandPaletteActionsContext>
      </CommandList>
    </Command>,
  )

  return Array.from(view.container.querySelectorAll('[cmdk-item=""]')).map((item) =>
    item.getAttribute('data-value'),
  )
}

test('the rendered list leads with the just-used command when a query is typed', () => {
  const rendered = renderCommandList('> mode', !paletteOwnsItemOrder('commands'))

  expect(rendered.slice(0, 2)).toEqual(['workspace.showSettings', 'workspace.showChatMode'])
})

test('cmdk would otherwise re-sort that order away', () => {
  // The control: same input, cmdk left in charge of ordering. If this ever matches the
  // recency-first order too, the test above has stopped proving anything.
  const rendered = renderCommandList('> mode', true)

  expect(rendered.slice(0, 2)).not.toEqual(['workspace.showSettings', 'workspace.showChatMode'])
})

test('the unfiltered list renders recents at the top', () => {
  const rendered = renderCommandList('>', !paletteOwnsItemOrder('commands'))

  expect(rendered.slice(0, 2)).toEqual(['workspace.showSettings', 'workspace.showChatMode'])
})
