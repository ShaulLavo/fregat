import { createContext, use } from 'react'

import { playControlFeedback } from '@workspace/ui/patterns/feedback-layer'

/** How a picker, popover or menu presents: against its trigger, or as a sheet on the bottom edge. */
export type Presentation = 'anchored' | 'sheet'

/** The shell's choice for every floating picker below it; the phone shell provides `sheet`. */
export const PresentationContext = createContext<Presentation>('anchored')

/** The shell's presentation, unless the surface asks for one (a menu that must track a caret). */
export function usePresentation(requested?: Presentation): Presentation {
  const shell = use(PresentationContext)
  return requested ?? shell
}

/** A sheet is modal, so it opens with the dialog's voice. */
export function playSheetOpen(presentation: Presentation, open: boolean, event: Event) {
  if (presentation === 'sheet' && open) playControlFeedback('open', event)
}

/** Pinned to the bottom edge, above an iOS keyboard. Important, because Base UI writes the
    anchored coordinates inline. */
export const SHEET_POSITIONER_CLASS =
  'isolate z-50 fixed! inset-x-0! top-auto! bottom-(--keyboard-inset)! transform-none!'

export const SHEET_BACKDROP_CLASS =
  'fixed inset-0 isolate z-50 bg-black/10 ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0'

/** The sheet's surface; a call site's classes follow it and may change its padding or layout. */
export const SHEET_SURFACE_CLASS =
  'flex flex-col overflow-y-auto overscroll-contain p-(--density-sheet-padding) text-xs text-popover-foreground bg-popover-solid shadow-xl ring-1 ring-foreground/10 outline-hidden ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom'

/** Applied after the call site's classes: an anchored width or height cap never shapes a sheet. */
export const SHEET_FRAME_CLASS =
  'mx-auto w-full min-w-0 max-w-(--sheet-max-width) max-h-(--sheet-max-height) rounded-t-lg [clip-path:none] pb-[max(env(safe-area-inset-bottom),var(--density-sheet-padding))]'
