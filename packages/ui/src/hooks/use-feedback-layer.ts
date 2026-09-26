import { useEffect } from 'react'
import { installFeedbackListeners } from '../patterns/feedback-listeners'

export function useFeedbackLayer() {
  useEffect(() => installFeedbackListeners(document), [])
}
