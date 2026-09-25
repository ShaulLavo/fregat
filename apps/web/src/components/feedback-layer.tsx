import { useFeedbackSettings } from '@/hooks/use-feedback-settings'

/** The app's sounds: settings reach the engine here. Renders nothing. */
export function FeedbackLayer() {
  useFeedbackSettings()
  return null
}
