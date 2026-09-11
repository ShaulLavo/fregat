import { describe } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { workLogEntry } from '../../../../../test/factories/work-log'
import { isWorkLogToolEntry, workLogEntryLabel } from '@/features/chat/utils/tool-label'

describe('work log labels', () => {
  test.each([
    ['rg -n gutter apps/web', 'Running rg'],
    ['/usr/bin/bash -lc "rg -n gutter apps/web"', 'Running rg'],
    ["/usr/bin/bash -lc 'bun --bun vitest run'", 'Running bun'],
    ['env CI=1 /usr/bin/bun test', 'Running bun'],
    ['rg gutter apps; sed -n 1,20p file', 'Running command'],
    ['if test -f file; then rg gutter file; fi', 'Running command'],
    ['$(get_binary) file', 'Running command'],
  ])('describes static commands conservatively: %s', (command, expected) => {
    expect(workLogEntryLabel(workLogEntry({ command, lifecycle: 'running' }), true)).toBe(expected)
  })

  test.each([
    ['completed', 'Ran rg'],
    ['failed', 'Failed rg'],
    ['declined', 'Declined rg'],
    ['stopped', 'Stopped rg'],
  ] as const)(
    'retains the tool terminal status when the response is active: %s',
    (lifecycle, expected) => {
      expect(workLogEntryLabel(workLogEntry({ command: 'rg files', lifecycle }), true)).toBe(
        expected,
      )
    },
  )

  test('uses parsed file and MCP identities while preserving friendly historical titles', () => {
    expect(
      workLogEntryLabel(
        workLogEntry({ lifecycle: 'running', tool: { kind: 'read', target: 'src/editor.ts' } }),
        true,
      ),
    ).toBe('Reading src/editor.ts')
    expect(
      workLogEntryLabel(
        workLogEntry({
          lifecycle: 'completed',
          tool: { kind: 'mcp', target: 'linear · get_issue' },
        }),
        false,
      ),
    ).toBe('Used linear · get_issue')
    expect(
      workLogEntryLabel(
        workLogEntry({
          lifecycle: 'completed',
          itemType: 'command_execution',
          title: 'Checked editor layout',
        }),
        false,
      ),
    ).toBe('Checked editor layout')
  })

  test('does not claim completion for a historical tool missing its terminal event', () => {
    expect(
      workLogEntryLabel(workLogEntry({ command: 'rg gutter', lifecycle: 'running' }), false),
    ).toBe('Started rg')
  })

  test('does not mistake thinking for a tool', () => {
    const entry = workLogEntry({
      sourceKind: 'task.progress',
      tone: 'thinking',
      title: 'Inspecting layout',
    })
    expect(isWorkLogToolEntry(entry)).toBe(false)
    expect(workLogEntryLabel(entry, true)).toBe('Inspecting layout')
  })
})
