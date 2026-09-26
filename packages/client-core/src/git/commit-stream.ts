import type { GitCommitProgressEvent, GitCommitResult } from '@workspace/contracts'
import { parseEdenSseStream } from '../transport/eden'

export type GitCommitProgressLine = { stream: 'stderr' | 'stdout'; text: string }

export type GitCommitStreamOutcome =
  | { kind: 'result'; result: GitCommitResult }
  | { kind: 'failed'; message: string }
  | { kind: 'ended-without-result' }

/**
 * Reads a commit-stream response to completion, relaying each hook output line as it arrives.
 * A `failed` frame is an ordinary hook rejection, not a transport fault, so this returns it
 * instead of throwing — each caller carries its own error copy for that case.
 */
export async function readGitCommitStream(
  stream: unknown,
  onProgress: (line: GitCommitProgressLine) => void,
): Promise<GitCommitStreamOutcome> {
  for await (const event of parseEdenSseStream(stream)) {
    // Sent through a hook's silences, such as a typecheck that prints nothing for a minute.
    if (event.event === 'heartbeat') continue

    const data = event.data as GitCommitProgressEvent
    if (data.kind === 'progress') {
      onProgress({ stream: data.stream, text: data.text })
      continue
    }
    if (data.kind === 'failed') return { kind: 'failed', message: data.message }

    return { kind: 'result', result: data.result }
  }

  return { kind: 'ended-without-result' }
}
