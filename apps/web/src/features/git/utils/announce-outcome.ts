import { playFeedback } from '@workspace/ui/patterns/feedback-layer'
import { toast } from 'sonner'

/** Toasts a remote write's outcome; a success also plays the Git sound. */
export function announceOutcome(outcome: {
  readonly tone: 'success' | 'error'
  readonly title: string
  readonly detail: string
}) {
  if (outcome.tone === 'error') {
    toast.error(outcome.title, { description: outcome.detail })
    return
  }
  playFeedback('success', 'git')
  toast.success(outcome.title, { description: outcome.detail })
}
