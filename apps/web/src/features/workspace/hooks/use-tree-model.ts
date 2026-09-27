import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { FileTreeOptions } from '@workspace/tree'
import { TreeViewModel } from '@/features/workspace/state/tree-model'

interface CleanUpRef {
  timeout: ReturnType<typeof setTimeout> | null
  model: TreeViewModel
}

export interface UseTreeModelResult {
  model: TreeViewModel
}

// Creates the model exactly once so React callers have a stable imperative
// runtime. Controller and initial options are constructor-only; supported
// mutable visual options are synced below.
export function useTreeModel(options: FileTreeOptions): UseTreeModelResult {
  const [model] = useState(() => new TreeViewModel(options))
  const cleanUpRef = useRef<CleanUpRef>({ timeout: null, model })
  const iconsRef = useRef(options.icons)
  const gitStatusRef = useRef(options.gitStatus)
  const densityRef = useRef(options.density)
  const itemHeightRef = useRef(options.itemHeight)

  useLayoutEffect(() => {
    if (densityRef.current === options.density && itemHeightRef.current === options.itemHeight) {
      return
    }

    densityRef.current = options.density
    itemHeightRef.current = options.itemHeight
    model.setDensity(options.density, options.itemHeight)
  }, [model, options.density, options.itemHeight])

  useLayoutEffect(() => {
    if (iconsRef.current === options.icons) {
      return
    }

    iconsRef.current = options.icons
    model.setIcons(options.icons)
  }, [model, options.icons])

  useLayoutEffect(() => {
    if (gitStatusRef.current === options.gitStatus) {
      return
    }

    gitStatusRef.current = options.gitStatus
    model.setGitStatus(options.gitStatus)
  }, [model, options.gitStatus])

  useEffect(() => {
    const { current } = cleanUpRef
    // NOTE(amadeus): This is designed to ensure strict mode doesn't blow away
    // our instance -- we wait a cycle to clean up
    if (current.timeout != null) {
      clearTimeout(current.timeout)
      current.timeout = null
    }
    return () => {
      current.timeout = setTimeout(() => current.model.cleanUp(), 1)
    }
  }, [])
  return { model }
}
