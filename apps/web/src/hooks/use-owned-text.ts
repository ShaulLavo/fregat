import { useState } from 'react'

import { commitOwnedText, initialOwnedText, settleOwnedText } from '@/hooks/utils/owned-text'

/**
 * A controlled field whose owner updates asynchronously (a navigation intent, a mutation) sees React
 * restore the stale prop after every keystroke and write the new one a tick later. Chrome drops the
 * field's native undo history on each programmatic set, so Ctrl+Z dies. This keeps the text local
 * and synchronous while a value the owner changes on its own (history, clear) still wins.
 */
export function useOwnedText(external: string, commit: (next: string) => void) {
  const [state, setState] = useState(() => initialOwnedText(external))
  if (external !== state.seen) setState(settleOwnedText(state, external))

  function change(next: string) {
    setState((current) => commitOwnedText(current, next))
    commit(next)
  }

  return [state.text, change] as const
}
