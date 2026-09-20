import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'

import {
  fileTreeFileOpenIntent,
  fileTreeRowElements,
  fileTreeRowPath,
} from '@/features/workspace/utils/file-tree-prefetch'
import { useFileTreeActions } from '@/features/workspace/hooks/use-file-tree-actions'
import {
  createIntentPrefetchRegistry,
  type IntentPrefetchRegistry,
  type IntentPrefetchRow,
} from '@/features/workspace/utils/intent-prefetch-registry'
import { createIdleScheduler } from '@/features/workspace/utils/intent-prefetch-scheduler'
import { FILE_SNAPSHOT_STALE_MS } from '@/lib/file-snapshot-query-cache'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { entryForTreePath, type TreeModel } from '@/lib/tree-model'
import type { FileTreeModel } from '@workspace/tree'

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
    const shadowRoot = tree.getFileTreeContainer()?.shadowRoot
    if (!shadowRoot) {
      registry.clear()
      return
    }

    registry.sync(fileTreeRowElements(shadowRoot), prefetchTreePath)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const registry = createIntentPrefetchRegistry({
      hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
      reactivateAfter: FILE_SNAPSHOT_STALE_MS,
      resolveRow: resolveFileTreeRow,
    })
    let observer: MutationObserver | null = null
    const schedule = createIdleScheduler(() => {
      if (observer === null) observer = observeTreeRows(tree, schedule.request)
      syncRegistrations(registry)
    })
    const unsubscribe = tree.subscribe(schedule.request)

    schedule.request()

    return () => {
      unsubscribe()
      observer?.disconnect()
      schedule.cancel()
      registry.clear()
    }
  }, [rootPath, tree])
}

function resolveFileTreeRow(element: HTMLElement): IntentPrefetchRow<string> | null {
  const treePath = fileTreeRowPath(element)
  if (!treePath) return null

  return {
    intent: treePath,
    key: treePath,
    meta: { treePath },
    name: `file-tree:${treePath}`,
  }
}

function observeTreeRows(tree: FileTreeModel, onChange: () => void): MutationObserver | null {
  if (typeof MutationObserver === 'undefined') return null

  const shadowRoot = tree.getFileTreeContainer()?.shadowRoot
  if (!shadowRoot) return null

  const observer = new MutationObserver(onChange)
  observer.observe(shadowRoot, {
    attributeFilter: ['data-item-path'],
    attributes: true,
    childList: true,
    subtree: true,
  })
  return observer
}
