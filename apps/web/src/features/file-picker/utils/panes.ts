/** Pixel bounds of the picker's three panes; the places keep their labels, the preview its facts. */
export const PLACES_PANE = { defaultPx: 180, minPx: 140, maxPx: 320 } as const
export const PREVIEW_PANE = { defaultPx: 260, minPx: 220, maxPx: 560 } as const
export const BROWSE_MIN_PX = 320

// Tailwind's `lg`: below it the picker hides places and preview, so there is nothing to resize.
export const WIDE_QUERY = '(min-width: 64rem)'
// Below Tailwind's `sm` the picker fills the screen and a tap opens a folder.
export const COMPACT_QUERY = '(max-width: 39.99rem)'
