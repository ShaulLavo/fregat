import { planStepStatus } from '@workspace/contracts'
import { compactActivityLabel } from '@/features/chat/utils/activity-label'
import type { OrchestrationSessionActivity } from '@workspace/contracts'
import { commandIsSingleSearch } from '@/features/chat/utils/command-label'

export type ChatActivityIconKey =
  | 'approval'
  | 'context'
  | 'error'
  | 'info'
  | 'task'
  | 'thinking'
  | 'tool'
  | 'user-input'

export type ChatActivityOutcome = 'failed' | 'neutral' | 'succeeded'

export type ChatActivityLifecycle = 'running' | 'completed' | 'failed' | 'declined' | 'stopped'

export type ChatActivityTool = {
  kind: 'read' | 'edit' | 'search' | 'browse' | 'mcp'
  target: string
}

type ChatActivityPlanStepStatus = 'completed' | 'inProgress' | 'pending'

export type ChatActivityPlanStep = {
  status: ChatActivityPlanStepStatus
  step: string
}

export type ChatActivityPresentation = {
  changedFiles: readonly string[]
  command: string | null
  detail: string | null
  icon: ChatActivityIconKey
  input: string | null
  lifecycle: ChatActivityLifecycle | null
  outcome: ChatActivityOutcome | null
  output: string | null
  result?: string
  status: string | null
  title: string
  tool?: ChatActivityTool
  toolCallId: string | null
}

/** Raw provider payloads carry whole file bodies; the row only ever shows a scrollable excerpt. */
const MAX_COMMAND_LENGTH = 2_000
const MAX_OUTPUT_LENGTH = 4_000

/**
 * Providers routinely report a successful lifecycle status while the failure only
 * exists as text in the tool's own output, so the row has to read the output too.
 */
const TOOL_FAILURE_PHRASES = [
  'command not found',
  'commandnotfoundexception',
  'enoent',
  'file not found',
  'is not recognized as the name of a cmdlet',
  'no files found',
  'no such file or directory',
  'permission denied',
]

const TOOL_FAILURE_PATTERNS = [
  /exit(?:ed)? with exit code\s+[1-9]\d*/i,
  /exit code\s*[:=\s]\s*[1-9]\d*\b/i,
]

export function chatActivityPresentation(
  activity: OrchestrationSessionActivity,
): ChatActivityPresentation {
  const payload = recordPayload(activity.payload)
  const data = activityData(payload)
  const title = activityTitle(activity, payload)
  const command = activityCommand(data)
  const output = activityOutput(data)
  const detail = commandDetail(activityDetail(activity, payload, title), command)
  const outcome = activityOutcome(activity, payload, data, [
    detail === command ? null : detail,
    output,
  ])
  const lifecycle = activityLifecycle(activity, payload, data, outcome)
  const tool = activityTool(activity, payload, data)
  const result = activityResult(data, command, output)

  return {
    changedFiles: tool?.kind === 'read' ? [] : activityChangedFiles(data),
    command,
    detail,
    icon: activityIcon(activity),
    input: activityInput(data, command),
    lifecycle,
    outcome,
    output: output ? truncateText(output, MAX_OUTPUT_LENGTH) : null,
    ...(result ? { result } : {}),
    status: activityStatus(activity, payload, lifecycle),
    title,
    ...(tool ? { tool } : {}),
    toolCallId: chatActivityToolCallId(activity),
  }
}

/**
 * Lifecycle events of one tool call share a provider item id (Codex `id`, Claude
 * `tool_use_id`); it is the only key that folds "started" and "completed" into one row.
 */
export function chatActivityToolCallId(activity: OrchestrationSessionActivity) {
  const payload = recordPayload(activity.payload)
  const data = activityData(payload)

  return (
    stringValue(payload.toolCallId) ??
    stringValue(data.toolCallId) ??
    stringValue(data.id) ??
    stringValue(data.tool_use_id) ??
    stringValue(data.toolUseId)
  )
}

function activityData(payload: Record<string, unknown>) {
  const data = recordPayload(payload.data)
  return { ...data, ...recordPayload(data.item) }
}

export function chatActivityPlanSteps(
  activity: OrchestrationSessionActivity,
): readonly ChatActivityPlanStep[] {
  if (activity.kind !== 'turn.plan.updated') return []

  const rawPlan = recordPayload(activity.payload).plan
  if (!Array.isArray(rawPlan)) return []

  const steps: ChatActivityPlanStep[] = []
  for (const entry of rawPlan) {
    const step = stringValue(recordPayload(entry).step)
    if (!step) continue

    steps.push({ status: planStepStatus(recordPayload(entry).status), step })
  }

  return steps
}

function toolTextLooksLikeFailure(text: string) {
  if (text.trim().length === 0) return false

  const lowered = text.toLowerCase()
  if (TOOL_FAILURE_PHRASES.some((phrase) => lowered.includes(phrase))) return true

  return TOOL_FAILURE_PATTERNS.some((pattern) => pattern.test(text))
}

function activityTitle(activity: OrchestrationSessionActivity, payload: Record<string, unknown>) {
  if (activity.kind === 'approval.requested') return 'Approval requested'
  if (activity.kind === 'approval.resolved') return 'Approval resolved'
  if (activity.kind === 'user-input.requested') return 'User input requested'
  if (activity.kind === 'user-input.resolved') return 'User input resolved'
  if (activity.kind === 'runtime.warning' || activity.kind === 'runtime.error') {
    return firstStringValue(payload, ['message', 'detail']) ?? activity.summary
  }
  if (activity.kind === 'mcp.status.updated' && chatActivityHasFailure(activity)) {
    const name =
      stringValue(recordPayload(payload.status).name) ??
      stringValue(payload.serverName) ??
      stringValue(payload.server)
    return `${name ?? 'MCP'} connection failed`
  }
  if (activity.kind === 'context-compaction') return 'Context compacted'
  if (activity.kind === 'context-window.updated') return 'Context window updated'
  if (activity.kind === 'task.started') return 'Task started'
  if (activity.kind === 'task.progress') return taskProgressTitle(activity, payload)
  if (activity.kind === 'task.completed') return taskCompletedTitle(activity, payload)
  if (activity.kind.startsWith('tool.')) return toolTitle(activity, payload)

  return activity.summary
}

function taskCompletedTitle(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
) {
  const summary = stringValue(payload.summary)
  if (summary) return summary
  const detail = stringValue(payload.detail)
  if (detail) return detail

  return completedTaskTitle(activity, payload)
}

function completedTaskTitle(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
) {
  const status = stringValue(payload.status)
  if (status === 'failed') return 'Task failed'
  if (status === 'stopped') return 'Task stopped'

  return activity.summary || 'Task completed'
}

function taskProgressTitle(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
) {
  const delta = chatActivityReasoningDelta(activity)
  if (delta !== null) return delta
  const summary = stringValue(payload.summary)
  if (summary) return summary
  const detail = stringValue(payload.detail)
  if (detail) return detail
  if (activity.summary !== 'Reasoning update') return activity.summary

  return 'Thinking'
}

export function chatActivityReasoningDelta(activity: OrchestrationSessionActivity) {
  if (activity.kind !== 'task.progress') return null
  const payload = recordPayload(activity.payload)
  if (payload.streamKind !== 'reasoning_text' && payload.streamKind !== 'reasoning_summary_text')
    return null

  const text = payload.summary ?? payload.detail
  return typeof text === 'string' ? text : null
}

function toolTitle(activity: OrchestrationSessionActivity, payload: Record<string, unknown>) {
  const data = activityData(payload)
  const explicitTitle = stringValue(payload.title)
  if (explicitTitle) return explicitTitle
  const server = stringValue(data.server)
  const tool = stringValue(data.tool)
  if (server && tool) return `${server} · ${tool}`

  const title = compactActivityLabel(activity.summary)
  if (title) return title

  return 'Tool'
}

function activityIcon(activity: OrchestrationSessionActivity): ChatActivityIconKey {
  if (activity.kind === 'turn.plan.updated') return 'task'
  if (activity.tone === 'error') return 'error'
  if (activity.tone === 'thinking') return 'thinking'
  if (activity.kind.startsWith('approval.')) return 'approval'
  if (activity.kind.startsWith('user-input.')) return 'user-input'
  if (activity.kind.startsWith('tool.')) return 'tool'
  if (activity.kind.startsWith('task.')) return 'task'
  if (activity.kind.startsWith('context-')) return 'context'

  return 'info'
}

function activityDetail(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
  title: string,
) {
  const detail =
    firstStringValue(payload, [
      'error',
      'failureReason',
      'message',
      'detail',
      'summary',
      'lastToolName',
    ]) ??
    stringValue(recordPayload(payload.error).message) ??
    firstStringValue(recordPayload(payload.status), ['error', 'failureReason'])
  if (activity.kind === 'task.progress') return detail && detail !== title ? detail : null
  if (activity.kind === 'task.completed') return detail && detail !== title ? detail : null
  if (detail && detail !== title) return detail
  if (detail === title) return null
  if (activity.summary !== title) return activity.summary

  return null
}

function activityStatus(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
  lifecycle: ChatActivityLifecycle | null,
) {
  if (lifecycle) return lifecycle === 'running' ? 'In progress' : formatStatus(lifecycle)
  const status = stringValue(payload.status)
  if (status) return formatStatus(status)
  if (activity.kind === 'tool.started') return 'Started'
  if (activity.kind === 'tool.updated') return 'Updated'
  if (activity.kind === 'tool.completed') return 'Completed'
  if (activity.kind === 'approval.requested') return 'Pending'
  if (activity.kind === 'user-input.requested') return 'Pending'
  if (activity.kind.endsWith('.resolved')) return 'Resolved'

  return null
}

function commandDetail(detail: string | null, command: string | null) {
  if (!detail || !command) return detail
  const text = detail.replace(/^(?:Bash|Shell|Command):\s*/i, '').trim()
  if (text === command.trim()) return null
  const prefix = text.replace(/(?:\.\.\.|…)$/, '')
  if (prefix !== text && prefix.length > 0 && command.startsWith(prefix)) return null

  return detail
}

function activityOutcome(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
  texts: readonly (string | null)[],
): ChatActivityOutcome | null {
  if (!activity.kind.startsWith('tool.')) return null
  if (activity.tone === 'error') return 'failed'
  if (data.is_error === true) return 'failed'
  if (recordPayload(data.result).isError === true || data.error) return 'failed'
  if (isEmptySearch(data, activityCommand(data), texts.filter(Boolean).join('\n'))) return 'neutral'
  if (isFailedExitCode(data)) return 'failed'

  const status = normalizedLifecycle(stringValue(payload.status) ?? stringValue(data.status))
  if (status === 'failed' || status === 'declined') return 'failed'
  if (toolTextLooksLikeFailure(texts.filter(Boolean).join('\n'))) return 'failed'
  if (activity.kind === 'tool.started') return 'neutral'
  if (activity.kind === 'tool.updated' && !status) return 'neutral'
  if (status === 'running' || status === 'stopped') return 'neutral'

  return 'succeeded'
}

function activityLifecycle(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
  outcome: ChatActivityOutcome | null,
): ChatActivityLifecycle | null {
  if (!activity.kind.startsWith('tool.') && !activity.kind.startsWith('task.')) return null

  const status = normalizedLifecycle(stringValue(payload.status) ?? stringValue(data.status))
  if (status === 'declined' || status === 'stopped') return status
  if (outcome === 'failed' || activity.tone === 'error') return 'failed'
  // A search with no matches exits 1 but finishes normally.
  if (status === 'failed' && outcome === 'neutral') return 'completed'
  if (status) return status
  if (activity.kind.endsWith('.completed')) return 'completed'

  return 'running'
}

function normalizedLifecycle(status: string | null): ChatActivityLifecycle | null {
  if (status === 'inProgress' || status === 'in_progress' || status === 'running') return 'running'
  if (status === 'completed' || status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'declined') return status
  if (status === 'stopped' || status === 'cancelled' || status === 'interrupted') return 'stopped'

  return null
}

function activityTool(
  activity: OrchestrationSessionActivity,
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
): ChatActivityTool | null {
  if (!activity.kind.startsWith('tool.')) return null
  const server = stringValue(data.server)
  const tool = stringValue(data.tool)
  if (server && tool) return { kind: 'mcp', target: `${server} · ${tool}` }

  const input = recordPayload(data.arguments ?? data.input ?? data.rawInput)
  const name =
    stringValue(data.name) ??
    stringValue(payload.title) ??
    stringValue(payload.itemType) ??
    compactActivityLabel(activity.summary)
  const mcpName = /^mcp__(.+?)__(.+)$/.exec(name)
  if (mcpName) return { kind: 'mcp', target: `${mcpName[1]} · ${mcpName[2]}` }
  const normalizedName = name.replace(/[\s_-]/g, '').toLowerCase()
  const path =
    firstStringValue(input, ['file_path', 'path', 'notebook_path']) ?? stringValue(data.path)
  if (/^(read|readfile|fileread)$/.test(normalizedName) && path)
    return { kind: 'read', target: path }
  if (/^(edit|write|editfile|writefile|filechange|notebookedit)$/.test(normalizedName)) {
    const target = path ?? changedFileTarget(activityChangedFiles(data))
    return target ? { kind: 'edit', target } : null
  }
  if (/^(websearch|search|grep|glob|codesearch)$/.test(normalizedName)) {
    const query = firstStringValue(input, ['query', 'pattern']) ?? stringValue(data.query)
    return query ? { kind: 'search', target: query } : null
  }
  if (/^(webfetch|browse|openurl)$/.test(normalizedName)) {
    const url = stringValue(input.url) ?? stringValue(data.url)
    return url ? { kind: 'browse', target: url } : null
  }

  return null
}

function changedFileTarget(files: readonly string[]) {
  if (files.length === 1) return files[0] ?? 'file'
  if (files.length > 1) return `${files.length} files`

  return null
}

function isFailedExitCode(data: Record<string, unknown>) {
  const exitCode = data.exitCode ?? data.exit_code

  return typeof exitCode === 'number' && exitCode !== 0
}

function isEmptySearch(
  data: Record<string, unknown>,
  command: string | null,
  output: string | null,
) {
  if ((data.exitCode ?? data.exit_code) !== 1 || !command) return false
  if (output && toolTextLooksLikeFailure(output)) return false

  return commandIsSingleSearch(command)
}

function activityResult(
  data: Record<string, unknown>,
  command: string | null,
  output: string | null,
) {
  const code = data.exitCode ?? data.exit_code
  if (isEmptySearch(data, command, output)) return 'No matches · Exit code 1'
  const diagnostic = output?.split('\n').find(toolTextLooksLikeFailure)
  const exit = typeof code === 'number' ? `Exit code ${code}` : null
  if (!diagnostic) return exit

  return [exit, truncateText(diagnostic.trim(), 300)].filter(Boolean).join('\n')
}

function activityCommand(data: Record<string, unknown>) {
  const input = recordPayload(data.input)
  const rawInput = recordPayload(data.rawInput)
  const command =
    stringValue(data.command) ??
    stringValue(input.command) ??
    stringValue(rawInput.command) ??
    argvCommand(data.command) ??
    argvCommand(input.command)
  if (!command) return null

  return truncateText(command, MAX_COMMAND_LENGTH)
}

function activityInput(data: Record<string, unknown>, command: string | null) {
  if (command) return null
  const input = data.arguments ?? data.input ?? data.rawInput
  if (input === undefined || input === null) return null

  return truncateText(
    typeof input === 'string' ? input : JSON.stringify(input, null, 2),
    MAX_OUTPUT_LENGTH,
  )
}

function argvCommand(value: unknown) {
  if (!Array.isArray(value)) return null

  const parts = value.filter((entry): entry is string => typeof entry === 'string')

  return parts.length > 0 ? parts.join(' ') : null
}

function activityOutput(data: Record<string, unknown>) {
  const rawOutput = recordPayload(data.rawOutput)
  const result = recordPayload(data.result)
  const output =
    stringValue(data.aggregatedOutput) ??
    stringValue(data.aggregated_output) ??
    stringValue(data.output) ??
    joinedOutput(data) ??
    toolResultText(data.content) ??
    toolResultText(result.content) ??
    stringValue(data.rawOutput) ??
    stringValue(rawOutput.content) ??
    stringValue(rawOutput.output) ??
    joinedOutput(rawOutput)
  if (!output) return null

  return output
}

function joinedOutput(data: Record<string, unknown>) {
  return [stringValue(data.stdout), stringValue(data.stderr)].filter(Boolean).join('\n') || null
}

export function chatActivityHasFailure(activity: OrchestrationSessionActivity) {
  const payload = recordPayload(activity.payload)
  const status = recordPayload(payload.status)
  if (activity.tone === 'error') return true
  if (payload.success === false || payload.status === 'failed' || status.status === 'failed')
    return true

  return Boolean(
    stringValue(payload.error) ??
    stringValue(payload.failureReason) ??
    stringValue(recordPayload(payload.error).message) ??
    firstStringValue(status, ['error', 'failureReason']),
  )
}

function toolResultText(content: unknown) {
  if (typeof content === 'string') return stringValue(content)
  if (!Array.isArray(content)) return null

  const parts: string[] = []
  for (const entry of content) {
    const text = stringValue(recordPayload(entry).text)
    if (!text) continue

    parts.push(text)
  }

  return parts.length > 0 ? parts.join('\n') : null
}

function activityChangedFiles(data: Record<string, unknown>): readonly string[] {
  const paths = changePaths(data.changes)
  if (paths.length > 0) return paths

  const input = recordPayload(data.input)
  const singlePath =
    stringValue(input.file_path) ?? stringValue(input.notebook_path) ?? stringValue(data.path)

  return singlePath ? [singlePath] : []
}

function changePaths(changes: unknown) {
  if (!Array.isArray(changes)) return []

  const paths: string[] = []
  for (const change of changes) {
    const path = stringValue(recordPayload(change).path)
    if (!path) continue

    paths.push(path)
  }

  return paths
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value

  return `${value.slice(0, maxLength)}\n…`
}

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) return value
  }

  return null
}

function recordPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}
  if (Array.isArray(payload)) return {}

  return payload as Record<string, unknown>
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function formatStatus(status: string) {
  if (status === 'inProgress') return 'In progress'

  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`
}
