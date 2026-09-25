import { WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect } from 'react'

import { playFeedback } from '@workspace/ui/patterns/feedback-layer'

/** The error toast's icon. It mounts once per error toast, so it also sounds the error. */
export function ToastErrorIcon() {
  useEffect(() => playFeedback('error', 'errors'), [])
  return <WarningCircleIcon className='text-destructive' weight='fill' />
}
