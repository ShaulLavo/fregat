import { dismissTopSheet } from '@workspace/ui/patterns/sheet'
import { useEffect } from 'react'

import { useNavigation } from '@/hooks/use-navigation'

/** The system Back gesture closes an open sheet first, as it does on iOS and Android, then pops. */
export function useBackClosesSheet() {
  const history = useNavigation().router.history

  useEffect(
    () =>
      history.block({
        // A blocked pop is undone by the history, so the screen under the sheet stays put.
        blockerFn: ({ action }) => action === 'BACK' && dismissTopSheet(),
        enableBeforeUnload: false,
      }),
    [history],
  )
}
