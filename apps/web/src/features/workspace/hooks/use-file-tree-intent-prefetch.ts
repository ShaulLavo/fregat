import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'

import { fileTreeFileOpenIntent } from '@/features/workspace/utils/file-tree-prefetch'
import { useFileTreeActions } from '@/features/workspace/hooks/use-file-tree-actions'
import {
  createIntentPrefetchRegistry,
  type IntentPrefetchRegistry,
  type IntentPrefetchTarget,
} from '@/features/workspace/utils/intent-prefetch-registry'
import { createIdleScheduler } from '@/features/workspace/utils/intent-prefetch-scheduler'
import { FILE_SNAPSHOT_STALE_MS } from '@/lib/file-snapshot-query-cache'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { canonicalTreePath } from '@/lib/path-formatters'
import { entryForTreePath, type TreeModel } from '@/lib/tree-model'
import type { FileTreeModel, FileTreeRowElement } from '@workspace/tree'

type FileTreeIntentPrefetchOptions = {
  model: TreeModel
  rootPath: string
  tree: FileTreeModel
}

export function useFileTreeIntentPrefetch({
  model,
  rootPath,
  tree,
}: FileTreeIntentPrefetchOptions) {
  const { service: fileOpenIntent } = useFileOpenIntent()
  const { prefetchDirectory } = useFileTreeActions()
  const modelRef = useRef(model)

  useLayoutEffect(() => {
    modelRef.current = model
  }, [model])

  const prefetchTreePath = useEffectEvent((treePath: string) => {
    const entry = entryForTreePath(modelRef.current, treePath)
    if (!entry) return
    if (isDirectoryEntry(entry)) {
      prefetchDirectory(entry, `${treePath}/`)
      return
    }
    const intent = fileTreeFileOpenIntent(rootPath, entry)
    if (!intent) return

    fileOpenIntent.prepare(intent)
  })

  const syncRegistrations = useEffectEvent((registry: IntentPrefetchRegistry<string>) => {
    registry.sync(tree.getRowElements().map(fileTreeRowTarget), prefetchTreePath)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const registry = createIntentPrefetchRegistry<string>({
      hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
      reactivateAfter: FILE_SNAPSHOT_STALE_MS,
    })
    const schedule = createIdleScheduler(() => syncRegistrations(registry))
    const unsubscribe = tree.subscribeRowElements(schedule.request)

    schedule.request()

    return () => {
      unsubscribe()
      schedule.cancel()
      registry.clear()
    }
  }, [rootPath, tree])
}

function fileTreeRowTarget({ element, path }: FileTreeRowElement): IntentPrefetchTarget<string> {
  const treePath = canonicalTreePath(path)

  return {
    element,
    row: {
      intent: treePath,
      key: treePath,
      meta: { treePath },
      name: `file-tree:${treePath}`,
    },
  }
}
