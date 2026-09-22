import { useSyncExternalStore } from 'react'

import { markerStore, type MarkerResource } from '@/lib/markers/store'

/** Every resource holding a marker, worst severity first. */
export function useMarkerResources(): readonly MarkerResource[] {
  return useSyncExternalStore(markerStore.subscribe, markerStore.resources, markerStore.resources)
}

export function useMarkerTotal(): number {
  return useSyncExternalStore(markerStore.subscribe, markerStore.total, markerStore.total)
}
