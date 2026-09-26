// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { FileTreeSearchBlurBehavior } from '../model/publicTypes'

export type FileTreeRowClickMode = 'flow' | 'sticky'

// A pure representation of what a mouse click on a file-tree row means. The
// input is the raw event modifiers plus a few static flags; the output is the
// set of logical operations the click should perform. Lives separately so the
// modifier-interaction table can be unit-tested without a controller or DOM.
export type FileTreeRowClickPlan = {
  selection: { kind: 'range'; additive: boolean } | { kind: 'toggle' } | { kind: 'single' }
  toggleDirectory: boolean
  closeSearch: boolean
  revealCanonical: boolean
}

export type FileTreeRowClickPlanInput = {
  event: {
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
  }
  mode: FileTreeRowClickMode
  isSearchOpen: boolean
  isDirectory: boolean
  searchBlurBehavior: FileTreeSearchBlurBehavior
}

export function computeFileTreeRowClickPlan(
  input: FileTreeRowClickPlanInput,
): FileTreeRowClickPlan {
  const { event, mode, isSearchOpen, isDirectory, searchBlurBehavior } = input
  const additive = event.ctrlKey || event.metaKey
  const hasModifier = event.shiftKey || additive

  const selection: FileTreeRowClickPlan['selection'] = event.shiftKey
    ? { additive, kind: 'range' }
    : additive
      ? { kind: 'toggle' }
      : { kind: 'single' }

  // Sticky rows are aria-hidden mirrors of in-flow rows, so every sticky click
  // must hand off to the canonical row even when modifiers suppress toggling.
  return {
    closeSearch: isSearchOpen && searchBlurBehavior === 'close',
    revealCanonical: mode === 'sticky',
    selection,
    toggleDirectory: !hasModifier && isDirectory,
  }
}
