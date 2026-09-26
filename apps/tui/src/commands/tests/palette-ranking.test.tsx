import { test, expect } from '../../../test/fixtures'
import { runPaletteCommand } from '../../../test/actions'
import { createCommandHarness } from '../../../test/commands'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { paletteOptions } from '@/commands/utils/palette'
import { effectiveTerminalBindings } from '@/commands/utils/bindings'
import { recentCommands } from '@/storage/recent-commands-policy'

for (const [chatQuery, workbenchQuery] of [
  ['Show chat', 'Open workbench'],
  ['workspace.revealChat', 'workspace.openWorkbench'],
]) {
  test(`native palette executes exact commands ${chatQuery} and ${workbenchQuery} ahead of recent category matches`, async ({
    server,
  }) => {
    const harness = await renderAgentNavigation(server)
    const { frame, ready } = harness
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      recentCommands.record(ready.storage, 'agent.clearScope')
      recentCommands.record(ready.storage, 'agent.openWorkbench')
      await runPaletteCommand(frame, chatQuery)
      await expect.poll(() => recentCommands.read(ready.storage)[0]).toBe('workspace.revealChat')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await runPaletteCommand(frame, workbenchQuery)
      await expect.poll(() => recentCommands.read(ready.storage)[0]).toBe('workspace.openWorkbench')
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('workbench-file-tree')
    } finally {
      await harness.cleanup()
    }
  })
}

test('empty command search keeps recent groups and configured shortcut labels', () => {
  const harness = createCommandHarness({
    handlers: {
      'workspace.revealChat': { run: () => {} },
      'agent.clearScope': { run: () => {} },
    },
  })
  try {
    const bindings = effectiveTerminalBindings({ 'workspace.revealChat': 'F7' }).bindings
    const rows = paletteOptions(harness.bus.capture('palette'), bindings, '>', ['agent.clearScope'])
    expect(rows[0]).toMatchObject({
      description: 'Recently Used',
      value: { id: 'agent.clearScope' },
    })
    expect(rows.find((row) => row.value.id === 'workspace.revealChat')?.name).toBe('Show chat  F7')
    const searched = paletteOptions(harness.bus.capture('palette'), bindings, '> SHOW CHAT ', [
      'agent.clearScope',
    ])
    expect(searched[0]).toMatchObject({
      name: 'Show chat  F7',
      value: { id: 'workspace.revealChat' },
    })
  } finally {
    harness.dispose()
  }
})
