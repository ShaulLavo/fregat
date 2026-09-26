import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import type { AgentDiagnostic, AgentDiagnosticsSource } from '../../../../lsp/agent-diagnostics'
import { diagnosticsFeedback, newErrors } from '../../../utils/agent-diagnostics-feedback'
import { claudeDiagnosticsHooks } from '../claude-diagnostics-hooks'

const CWD = '/repo'
const existing: AgentDiagnostic = { line: 3, message: 'Old problem.', code: '2304' }
const introduced: AgentDiagnostic = { line: 7, message: 'New problem.', code: '2322' }

function source(reads: readonly (readonly AgentDiagnostic[])[], enabled = true) {
  const calls: string[] = []
  const queue = [...reads]
  const reader: AgentDiagnosticsSource = {
    enabled: () => enabled,
    errors: async (filePath) => {
      calls.push(filePath)
      return { mode: 'pull', errors: queue.shift() ?? [] }
    },
  }
  return { calls, reader }
}

function hook(
  hooks: ReturnType<typeof claudeDiagnosticsHooks>,
  event: 'PreToolUse' | 'PostToolUse',
) {
  const callback: HookCallback | undefined = hooks[event]?.[0]?.hooks[0]
  if (!callback) throw new TypeError(`missing ${event} hook`)
  return (input: Record<string, unknown>) =>
    callback(
      {
        cwd: CWD,
        session_id: 's',
        transcript_path: '/t',
        tool_name: 'Edit',
        tool_use_id: 'tool-1',
        tool_input: { file_path: 'src/a.ts' },
        ...input,
      } as HookInput,
      'tool-1',
      { signal: new AbortController().signal },
    )
}

describe('diagnostics after an agent edit', () => {
  it('tells the agent only the errors its edit introduced', async () => {
    const { calls, reader } = source([[existing], [existing, introduced]])
    const hooks = claudeDiagnosticsHooks(reader)
    expect(hooks.PreToolUse?.[0]?.matcher).toBe('Edit|Write|MultiEdit|NotebookEdit')

    await hook(hooks, 'PreToolUse')({ hook_event_name: 'PreToolUse' })
    const output = await hook(
      hooks,
      'PostToolUse',
    )({
      hook_event_name: 'PostToolUse',
      tool_response: {},
    })

    expect(calls).toEqual(['/repo/src/a.ts', '/repo/src/a.ts'])
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: [
          '<new-diagnostics>',
          'Your edit to src/a.ts introduced 1 error:',
          '- line 7: New problem. (2322)',
          '</new-diagnostics>',
        ].join('\n'),
      },
    })
  })

  it('says nothing when the edit added no error, or the setting is off', async () => {
    const quiet = claudeDiagnosticsHooks(source([[existing], [existing]]).reader)
    await hook(quiet, 'PreToolUse')({ hook_event_name: 'PreToolUse' })
    expect(await hook(quiet, 'PostToolUse')({ hook_event_name: 'PostToolUse' })).toEqual({})

    const off = source([[], [introduced]], false)
    const disabled = claudeDiagnosticsHooks(off.reader)
    await hook(disabled, 'PreToolUse')({ hook_event_name: 'PreToolUse' })
    expect(await hook(disabled, 'PostToolUse')({ hook_event_name: 'PostToolUse' })).toEqual({})
    expect(off.calls).toEqual([])
  })

  it('matches errors as a multiset and caps what one file reports', () => {
    expect(newErrors([existing], [existing, existing])).toEqual([existing])
    const many = Array.from({ length: 12 }, (_, line) => ({ ...introduced, line: line + 1 }))
    const text = diagnosticsFeedback('a.ts', many) ?? ''
    expect(text).toContain('introduced 12 errors')
    expect(text).toContain('- and 2 more')
    expect(text.split('\n').filter((line) => line.startsWith('- line'))).toHaveLength(10)
    expect(diagnosticsFeedback('a.ts', [])).toBeNull()
  })
})
