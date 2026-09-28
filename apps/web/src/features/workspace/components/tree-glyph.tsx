// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { JSX } from 'react'

/** The changed-descendant dot on a folder row. */
export function TreeGlyphIcon(): JSX.Element {
  // A 6-unit viewport inside a 16-unit one, as the sprite nested it, so it lands on the same pixels.
  return (
    <svg
      aria-hidden='true'
      data-icon-name='file-tree-icon-dot'
      height={6}
      viewBox='0 0 16 16'
      width={6}
    >
      <svg viewBox='0 0 6 6'>
        <circle cx='3' cy='3' r='3' />
      </svg>
    </svg>
  )
}
