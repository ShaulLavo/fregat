// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import { type Dispatch, type SetStateAction, useLayoutEffect } from 'react'

import { getActiveTreeElement } from '@/features/workspace/utils/tree-focus'

/**
 * Follows DOM focus inside the tree: which row holds it, and whether the tree owns the keyboard.
 * A focus-out with no next target is checked a tick later, because virtualization can swap the
 * focused row between rendered and parked before the replacement takes focus.
 */
export function useTreeActiveItem({
  claimDomFocus,
  getRoot,
  releaseDomFocus,
  setActiveItemPath,
}: {
  readonly claimDomFocus: () => void
  readonly getRoot: () => HTMLElement | null
  readonly releaseDomFocus: () => void
  readonly setActiveItemPath: Dispatch<SetStateAction<string | null>>
}): void {
  useLayoutEffect(() => {
    const rootElement = getRoot()
    if (rootElement == null) {
      return
    }
    let nullFocusOutTimer: ReturnType<typeof setTimeout> | null = null

    const clearNullFocusOutTimer = (): void => {
      if (nullFocusOutTimer == null) {
        return
      }

      clearTimeout(nullFocusOutTimer)
      nullFocusOutTimer = null
    }

    const updateActiveItemPath = (): void => {
      const activeTreeElement = getActiveTreeElement(rootElement)
      const nextActiveItemPath = activeTreeElement?.dataset.itemPath ?? null
      setActiveItemPath((previousPath) =>
        previousPath === nextActiveItemPath ? previousPath : nextActiveItemPath,
      )
    }

    const onFocusIn = (): void => {
      clearNullFocusOutTimer()
      claimDomFocus()
      updateActiveItemPath()
    }
    const onFocusOut = (event: FocusEvent): void => {
      const nextTarget = event.relatedTarget
      if (nextTarget == null) {
        // Virtualization can swap the focused row between rendered and parked
        // states before the replacement element receives focus. Defer the
        // ownership check so a true blur to the page can still clear visual
        // focus once the browser has finished moving focus.
        clearNullFocusOutTimer()
        nullFocusOutTimer = setTimeout(() => {
          nullFocusOutTimer = null
          if (getActiveTreeElement(rootElement) != null) {
            updateActiveItemPath()
            return
          }

          releaseDomFocus()
          setActiveItemPath(null)
        }, 0)
        return
      }

      if (!(nextTarget instanceof Node) || !rootElement.contains(nextTarget)) {
        clearNullFocusOutTimer()
        releaseDomFocus()
        setActiveItemPath(null)
        return
      }

      const nextActiveItemPath =
        nextTarget instanceof HTMLElement ? (nextTarget.dataset.itemPath ?? null) : null
      setActiveItemPath((previousPath) =>
        previousPath === nextActiveItemPath ? previousPath : nextActiveItemPath,
      )
    }

    rootElement.addEventListener('focusin', onFocusIn)
    rootElement.addEventListener('focusout', onFocusOut)
    return () => {
      clearNullFocusOutTimer()
      rootElement.removeEventListener('focusin', onFocusIn)
      rootElement.removeEventListener('focusout', onFocusOut)
    }
  }, [claimDomFocus, getRoot, releaseDomFocus])
}
