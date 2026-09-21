import { clientInstanceId } from '@/lib/instance-id'
import type { ClientError } from '@/lib/client-error-taxonomy'

/**
 * What an agent needs to start on a failure the user just saw: the catalog's own
 * answer, and the command that pulls the wide event holding `internal` — the
 * runtime facts the message deliberately does not carry.
 */
export function agentErrorReport(error: ClientError, at = new Date()): string {
  const lines = [
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
