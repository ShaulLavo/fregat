import { useFeedbackSettings } from '@/hooks/use-feedback-settings'
import { useFeedbackLayer } from '@workspace/ui/hooks/use-feedback-layer'

/** The app's sounds: settings reach the engine here. Renders nothing. */
export function FeedbackLayer() {
  useFeedbackSettings()
  useFeedbackLayer()
  return null
}
