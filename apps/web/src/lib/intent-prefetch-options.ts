import { ForesightManager } from 'js.foresight'

export const INTENT_PREFETCH_HIT_SLOP_PX = 8

/**
 * Scroll prediction fires for every row a scroll passes: 112 of 145 row prefetches in the picker
 * over a 600-folder list. Pointer trajectory and keyboard prediction stay on.
 */
export function configureIntentPrediction() {
  ForesightManager.initialize({ enableScrollPrediction: false })
}
