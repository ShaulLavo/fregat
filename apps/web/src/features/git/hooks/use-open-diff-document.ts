import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useNavigation } from '@/hooks/use-navigation'
import type { ChangeRow } from '@/features/git/utils/types'
import { useState } from 'react'

export function useOpenDiffDocument() {
  const owner = useEditorWorkspaceStoreApi()
  const navigation = useNavigation()
  const [openingCount, setOpeningCount] = useState(0)

  async function openDiff(row: ChangeRow) {
    setOpeningCount((count) => count + 1)
    try {
      const result = await navigation.openDiff({ owner, row })
      setOpeningCount((count) => count - 1)
      return result
    } catch (error) {
      // Not `finally`: the compiler refuses the whole hook over one.
      setOpeningCount((count) => count - 1)
      throw error
    }
  }

  async function openDiffs(rows: readonly ChangeRow[]) {
    for (const row of rows) {
      const result = await openDiff(row)
      if (result.status !== 'applied') return
    }
  }

  return { opening: openingCount > 0, openDiff, openDiffs }
}
