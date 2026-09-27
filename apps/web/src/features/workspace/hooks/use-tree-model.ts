import { useLayoutEffect, useRef, useState } from 'react'

import type { FileTreeOptions } from '@workspace/tree'
import { TreeViewModel } from '@/features/workspace/state/tree-model'

export interface UseTreeModelResult {
  model: TreeViewModel
}

// Creates the model exactly once so React callers have a stable imperative runtime. The model owns
// everything it subscribes to, so it needs no teardown. Controller and initial options are
// constructor-only; row height and git status are synced below.
export function useTreeModel(options: FileTreeOptions): UseTreeModelResult {
  const [model] = useState(() => new TreeViewModel(options))
  const gitStatusRef = useRef(options.gitStatus)

  useLayoutEffect(() => {
    model.setItemHeight(options.itemHeight)
  }, [model, options.itemHeight])

  useLayoutEffect(() => {
    if (gitStatusRef.current === options.gitStatus) {
      return
    }

    gitStatusRef.current = options.gitStatus
    model.setGitStatus(options.gitStatus)
  }, [model, options.gitStatus])

  return { model }
}
