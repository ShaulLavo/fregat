import type { EditorPlugin, EditorScrollPosition, EditorViewSnapshot } from '@singapore-editor/core'
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

import type { DocumentKey } from '@/lib/documents/utils/types'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { capOverscrollTop } from '@/features/editor/utils/scroll-position'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'

type UseScrollPersistencePluginOptions = {
  document: Pick<EditorRenderDocument, 'key'>
  onScrollPositionChange?: (
    key: DocumentKey,
    scrollPosition: EditorScrollPosition,
    reopenScrollPosition?: EditorScrollPosition,
  ) => void
}

type ScrollPersistenceState = {
  key: DocumentKey
  onChange?: UseScrollPersistencePluginOptions['onScrollPositionChange']
}

type PendingScrollPosition = {
  left: number
  onChange: ScrollPersistenceState['onChange']
  key: DocumentKey
  top: number
  reopenTop: number
}

export function useScrollPersistencePlugin({
  document,
  onScrollPositionChange,
}: UseScrollPersistencePluginOptions) {
  const stateRef = useRef<ScrollPersistenceState>({
    onChange: onScrollPositionChange,
    key: document.key,
  })

  useLayoutEffect(() => {
    stateRef.current = {
      onChange: onScrollPositionChange,
      key: document.key,
    }
  }, [document.key, onScrollPositionChange])

  return useMemo<EditorPlugin>(
    () => ({
      name: 'platform-scroll-persistence',
      activate: (context) => {
        if (editorPerformanceFeatureDisabled('scroll-persistence')) return undefined

        return context.registerViewContribution({
          createContribution: () => {
            const persister = createScrollPositionPersister(stateRef)
            return {
              update: (snapshot) => persister.persistSnapshot(snapshot),
              dispose: () => persister.dispose(),
            }
          },
        })
      },
    }),
    [],
  )
}

// Scroll offsets come from the snapshot (editor tracked state, never the
// DOM), but the store write is flushed on the next animation frame: updates
// arrive synchronously inside the editor's scroll render pass, and notifying
// React subscribers there puts their work back into the hot frame.
function createScrollPositionPersister(stateRef: RefObject<ScrollPersistenceState>) {
  let lastKey: DocumentKey | null = null
  let lastLeft = -1
  let lastTop = -1
  let lastReopenTop = -1
  let pending: PendingScrollPosition | null = null
  let frame: number | null = null

  const flush = () => {
    frame = null
    const next = pending
    pending = null
    if (!next) return
    if (
      next.key === lastKey &&
      next.left === lastLeft &&
      next.top === lastTop &&
      next.reopenTop === lastReopenTop
    ) {
      return
    }

    lastKey = next.key
    lastLeft = next.left
    lastTop = next.top
    lastReopenTop = next.reopenTop
    next.onChange?.(
      next.key,
      { left: next.left, top: next.top },
      { left: next.left, top: next.reopenTop },
    )
  }

  return {
    persistSnapshot: (snapshot: EditorViewSnapshot) => {
      // The ref can move to another tab before this frame flushes.
      const state = stateRef.current
      if (snapshot.documentId !== null && snapshot.documentId !== state.key) return
      pending = {
        left: snapshot.viewport.scrollLeft,
        onChange: state.onChange,
        key: state.key,
        top: snapshot.viewport.scrollTop,
        reopenTop: capOverscrollTop(snapshot.viewport.scrollTop, snapshot),
      }
      if (frame !== null) return
      if (
        pending.key === lastKey &&
        pending.left === lastLeft &&
        pending.top === lastTop &&
        pending.reopenTop === lastReopenTop
      )
        return

      frame = requestAnimationFrame(flush)
    },
    dispose: () => {
      if (frame === null) return

      cancelAnimationFrame(frame)
      frame = null
      flush()
    },
  }
}
