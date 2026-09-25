import { OrbitLoader } from '@workspace/ui/components/orbit-loader'

import type { PendingRequestResponse } from '@/features/chat/providers/pending-requests-context'
import { InlineError } from '@/components/inline-error'

export function PendingRequestFeedback({ response }: { response: PendingRequestResponse }) {
  if (response.kind === 'idle') return null
  if (response.kind === 'failed') {
    return (
      <InlineError
        message={`Could not send your response. ${response.message}`}
        title='Pending request response'
      />
    )
  }

  return (
    <div className='text-muted-foreground text-2xs flex items-center gap-1.5' role='status'>
      <OrbitLoader aria-hidden='true' className='size-3' />
      {response.kind === 'submitting' ? 'Sending response…' : 'Response sent. Waiting for agent…'}
    </div>
  )
}
