import path from 'node:path'

import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk'
import { isRecord } from '@workspace/utils/objects'
import { elapsedMs } from '@workspace/utils/timing'

import type { AgentDiagnostic, AgentDiagnosticsSource } from '../../../lsp/agent-diagnostics'
import { recordChatPipelineInfo } from '../../../orchestration/orchestration-logging'
import { diagnosticsFeedback, newErrors } from '../../utils/agent-diagnostics-feedback'

const EDIT_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit'
/** One read before and one after an edit share this budget; a late answer is dropped. */
const BUDGET_MS = 1_500

/**
 * The errors an edit introduced, fed back to the agent after the tool result. The baseline is read
 * before the edit, so errors the file already had are left out.
 */
export function claudeDiagnosticsHooks(
  source: AgentDiagnosticsSource,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const baselines = new Map<string, readonly AgentDiagnostic[]>()
  const before: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || !source.enabled()) return {}
    const filePath = editedPath(input.tool_input, input.cwd)
    if (!filePath) return {}
    const baseline = await source.errors(filePath, input.cwd, BUDGET_MS / 2)
    baselines.set(input.tool_use_id, baseline?.errors ?? [])
    return {}
  }
  const after: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    const baseline = baselines.get(input.tool_use_id)
    baselines.delete(input.tool_use_id)
    const filePath = editedPath(input.tool_input, input.cwd)
    if (!filePath || !baseline || !source.enabled()) return {}
    const startedAt = performance.now()
    const result = await source.errors(filePath, input.cwd, BUDGET_MS / 2)
    const introduced = result ? newErrors(baseline, result.errors) : []
    recordChatPipelineInfo('agent.diagnostics', {
      durationMs: elapsedMs(startedAt),
      errorsAfter: result?.errors.length ?? null,
      errorsBefore: baseline.length,
      fileCount: 1,
      introducedCount: introduced.length,
      mode: result?.mode ?? null,
      provider: 'claude',
      timedOut: result === null,
    })
    const feedback = diagnosticsFeedback(path.relative(input.cwd, filePath), introduced)
    if (!feedback) return {}
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: feedback } }
  }
  return {
    PreToolUse: [{ matcher: EDIT_TOOLS, hooks: [before] }],
    PostToolUse: [{ matcher: EDIT_TOOLS, hooks: [after] }],
  }
}

function editedPath(toolInput: unknown, cwd: string) {
  if (!isRecord(toolInput)) return null
  const target = toolInput.file_path ?? toolInput.notebook_path
  if (typeof target !== 'string' || !target) return null
  return path.resolve(cwd, target)
}
