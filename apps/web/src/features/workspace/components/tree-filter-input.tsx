/** @jsxImportSource react */
import type { FileTreeController, FileTreeSearchBlurBehavior } from '@workspace/tree'
import type { JSX, RefObject } from 'react'

/** The always-visible filter box above the rows. */
export function TreeFilterInput({
  activeDescendantId,
  controller,
  fakeFocus,
  inputRef,
  isOpen,
  onInteract,
  placeholder,
  searchBlurBehavior,
  treeDomId,
  value,
}: {
  readonly activeDescendantId: string | undefined
  readonly controller: FileTreeController
  readonly fakeFocus: boolean
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly isOpen: boolean
  readonly onInteract: () => void
  readonly placeholder: string
  readonly searchBlurBehavior: FileTreeSearchBlurBehavior
  readonly treeDomId: string | undefined
  readonly value: string
}): JSX.Element {
  return (
    <div data-file-tree-search-container data-open={isOpen ? 'true' : 'false'}>
      <input
        ref={inputRef}
        aria-activedescendant={activeDescendantId}
        aria-controls={treeDomId}
        placeholder={placeholder}
        data-file-tree-search-input
        data-file-tree-search-input-fake-focus={fakeFocus ? 'true' : undefined}
        value={value}
        onBlur={() => {
          if (searchBlurBehavior === 'retain') return

          controller.closeSearch()
        }}
        onFocus={onInteract}
        onPointerDown={onInteract}
        onInput={(event) => {
          onInteract()
          const target = event.currentTarget
          controller.setSearch(target.value)
        }}
      />
    </div>
  )
}
