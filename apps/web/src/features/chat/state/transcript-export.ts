import { queryOptions } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchOrchestrationSessionTranscriptHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { downloadTextFile } from '@/features/chat/utils/download-text-file'
import { sessionTranscriptKeys } from '@/features/chat/utils/query-keys'
import {
  transcriptFilename,
  transcriptJson,
  transcriptMarkdown,
  type TranscriptFormat,
} from '@/features/chat/utils/transcript-export'
import { copyTextToClipboard } from '@/lib/clipboard'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

const MIME_TYPES: Record<TranscriptFormat, string> = {
  json: 'application/json',
  markdown: 'text/markdown',
}

function sessionTranscriptQueryOptions(ref: ScopedSessionRef) {
  return queryOptions({
    queryKey: sessionTranscriptKeys.transcript(ref.environmentId, ref.sessionId),
    queryFn: ({ client, signal }) =>
      fetchOrchestrationSessionTranscriptHttp(ref.sessionId, clientForQueryClient(client), signal),
    // Every export reads the session as it is now, and a long transcript is not
    // worth holding once it has been written out.
    gcTime: 0,
    staleTime: 0,
  })
}

export async function downloadSessionTranscript(ref: ScopedSessionRef, format: TranscriptFormat) {
  const transcript = await readTranscript(ref)
  if (!transcript) return

  const text = format === 'markdown' ? transcriptMarkdown(transcript) : transcriptJson(transcript)
  downloadTextFile(transcriptFilename(transcript.session.title, format), text, MIME_TYPES[format])
}

export async function copySessionTranscript(ref: ScopedSessionRef) {
  const transcript = await readTranscript(ref)
  if (!transcript) return

  await copyTextToClipboard(transcriptMarkdown(transcript), 'conversation')
}

async function readTranscript(ref: ScopedSessionRef) {
  try {
    const queryClient = queryClientFor(confirmedEnvironmentOrigin(ref.environmentId))
    return await queryClient.fetchQuery(sessionTranscriptQueryOptions(ref))
  } catch (error) {
    toastError('Could not read the conversation', {
      description: errorMessage(error, 'The session transcript could not be loaded.'),
    })
    return null
  }
}
