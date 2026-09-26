import { useSyncExternalStore } from 'react'

// Tailwind's `lg`: below it the picker hides places and preview, so there is nothing to resize.
const WIDE_QUERY = '(min-width: 64rem)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isWide() {
  return window.matchMedia(WIDE_QUERY).matches
}

/** Whether the viewport has room for the places sidebar and the preview beside the listing. */
export function useWideLayout() {
  return useSyncExternalStore(subscribe, isWide, () => true)
}
