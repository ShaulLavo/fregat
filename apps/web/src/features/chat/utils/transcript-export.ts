import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSessionTranscript,
} from '@workspace/contracts'

import { workLogEntryLabel } from '@/features/chat/utils/tool-label'
import { messageMarkdown } from '@/features/chat/utils/message-markdown'
import { chatWorkLogEntries, type ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export type TranscriptFormat = 'markdown' | 'json'

type TranscriptPart =
  | { readonly kind: 'message'; readonly createdAt: string; readonly message: OrchestrationMessage }
  | { readonly kind: 'step'; readonly createdAt: string; readonly entry: ChatWorkLogEntry }
  | {
      readonly kind: 'plan'
      readonly createdAt: string
      readonly plan: OrchestrationProposedPlan
    }

const ROLE_HEADINGS: Record<OrchestrationMessage['role'], string> = {
  assistant: 'Assistant',
  system: 'System',
  user: 'User',
}

/** Readable: messages and plans in full, each work step as its one-line label. */
export function transcriptMarkdown(transcript: OrchestrationSessionTranscript) {
  const { session } = transcript
  const lines = [
    `# ${session.title}`,
    '',
    `- Session: \`${session.id}\``,
    `- Model: \`${session.modelSelection.model}\``,
    `- Started: ${session.createdAt}`,
  ]
  let steps: string[] = []
  for (const part of transcriptParts(transcript)) {
    if (part.kind === 'step') {
      steps.push(stepLine(part.entry))
      continue
    }
    lines.push(...flushSteps(steps))
    steps = []
    lines.push('', ...partLines(part))
  }
  lines.push(...flushSteps(steps))

  return `${lines.join('\n').trimEnd()}\n`
}

/** Complete: everything the projection holds, as it holds it. */
export function transcriptJson(transcript: OrchestrationSessionTranscript) {
  return `${JSON.stringify(transcript, null, 2)}\n`
}

export function transcriptFilename(title: string, format: TranscriptFormat) {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session'
  return `${stem}.${format === 'markdown' ? 'md' : 'json'}`
}

function transcriptParts(transcript: OrchestrationSessionTranscript): TranscriptPart[] {
  const parts: TranscriptPart[] = [
    ...transcript.session.messages.map((message) => ({
      kind: 'message' as const,
      createdAt: message.createdAt,
      message,
    })),
    ...chatWorkLogEntries({ activities: transcript.session.activities })
      .filter((entry) => !entry.plan)
      .map((entry) => ({ kind: 'step' as const, createdAt: entry.createdAt, entry })),
    ...transcript.proposedPlans.map((plan) => ({
      kind: 'plan' as const,
      createdAt: plan.createdAt,
      plan,
    })),
  ]
  // A stable sort keeps each source's own order for rows stamped the same instant.
  return parts.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function partLines(part: Exclude<TranscriptPart, { kind: 'step' }>) {
  if (part.kind === 'plan') return ['## Plan', '', part.plan.planMarkdown.trim()]

  const { message } = part
  const attachments = message.attachments.map((attachment) => attachment.name)
  return [
    `## ${ROLE_HEADINGS[message.role]}`,
    '',
    messageMarkdown(message).trim() || '_(no text)_',
    ...(attachments.length > 0 ? ['', `Attachments: ${attachments.join(', ')}`] : []),
  ]
}

function stepLine(entry: ChatWorkLogEntry) {
  const label = workLogEntryLabel(entry, false)
  const command = entry.command?.split('\n')[0]?.trim()
  return command ? `- ${label}: ${inlineCode(command)}` : `- ${label}`
}

function inlineCode(value: string) {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestRun + 1)
  const padding = longestRun > 0 ? ' ' : ''
  return `${fence}${padding}${value}${padding}${fence}`
}

function flushSteps(steps: readonly string[]) {
  return steps.length > 0 ? ['', ...steps] : []
}
