import { clientInstanceId } from '@/lib/instance-id'
import type { ClientError } from '@/lib/client-error-taxonomy'

/** A failure as the user saw it: a catalog error, or a title and the message beside it. */
export type AgentErrorInput = Pick<ClientError, 'message'> &
  Partial<Pick<ClientError, 'code' | 'fix' | 'operation' | 'why'>> & {
    /** What the surface called the failure: "Could not save the palette". */
    readonly title?: string
  }

/**
 * What an agent needs to start on a failure the user just saw: the catalog's own
 * answer, and the command that pulls the wide event holding `internal` — the
 * runtime facts the message deliberately does not carry.
 */
export function agentErrorReport(error: AgentErrorInput, at = new Date()): string {
  const lines = [
    ...(error.title && error.title !== error.message ? [`title: ${error.title}`] : []),
    `code: ${error.code ?? 'unknown'}`,
    `message: ${error.message}`,
    ...(error.why ? [`why: ${error.why}`] : []),
    ...(error.fix ? [`fix: ${error.fix}`] : []),
    ...(error.operation ? [`operation: ${error.operation}`] : []),
    `at: ${at.toISOString()}`,
    `logs: bun run logs --since ${new Date(at.getTime() - 60_000).toISOString()}`,
    `client instance: ${clientInstanceId()}`,
  ]
  return lines.join('\n')
}

/** The composer text "Fix with AI" starts a chat with. */
export function agentFixPrompt(error: AgentErrorInput, at = new Date()): string {
  return [
    'Platform showed me this error. Find the cause and fix it; if the fix is something only I can do, tell me the steps.',
    '',
    '```',
    agentErrorReport(error, at),
    '```',
  ].join('\n')
}
