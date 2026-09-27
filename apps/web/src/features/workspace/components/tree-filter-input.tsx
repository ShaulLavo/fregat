// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { FileTreeController, FileTreeSearchBlurBehavior } from '@workspace/tree'
import type { JSX, Ref, RefObject } from 'react'
import { FilterField, type FilterFieldHandle } from '@workspace/ui/patterns/filter-field'

/** The always-visible filter box above the rows. */
export function TreeFilterInput({
  fieldRef,
  onArrowDown,
  activeDescendantId,
  controller,
  inputRef,
  placeholder,
  searchBlurBehavior,
  treeDomId,
  value,
}: {
  readonly fieldRef: Ref<FilterFieldHandle>
  readonly onArrowDown: () => void
  readonly activeDescendantId: string | undefined
  readonly controller: FileTreeController
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly placeholder: string
  readonly searchBlurBehavior: FileTreeSearchBlurBehavior
  readonly treeDomId: string | undefined
  readonly value: string
}): JSX.Element {
  return (
    <FilterField
      ref={fieldRef}
      inputRef={inputRef}
      aria-label={placeholder}
      aria-activedescendant={activeDescendantId}
      aria-controls={treeDomId}
      placeholder={placeholder}
      data-file-tree-search-input
      value={value}
      blurBehavior={searchBlurBehavior === 'retain' ? 'retain' : 'clear'}
      clearLabel='Clear file filter'
      onArrowDown={onArrowDown}
      onValueChange={(next) => {
        if (next) controller.setSearch(next)
        else controller.closeSearch()
      }}
    />
  )
}
