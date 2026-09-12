import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { Spinner } from '@workspace/ui/components/spinner'

import type { PendingRequestResponse } from '@/features/chat/providers/pending-requests-context'

export function PendingRequestFeedback({ response }: { response: PendingRequestResponse }) {
  if (response.kind === 'idle') return null
  if (response.kind === 'failed') {
    return (
      <p className='text-destructive text-xs' role='alert'>
        Could not send your response. {response.message}
      </p>
    )
  }

  return (
    <div className='text-muted-foreground text-2xs flex items-center gap-1.5' role='status'>
      {response.kind === 'submitting' ? (
        <Spinner aria-hidden='true' className='size-3' />
      ) : (
        <OrbitLoader aria-hidden='true' className='size-3' />
      )}
      {response.kind === 'submitting' ? 'Sending response…' : 'Response sent. Waiting for agent…'}
    </div>
  )
}
