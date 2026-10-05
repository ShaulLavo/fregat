import { useCallback, useEffect, useEffectEvent } from 'react'
import { useForesight } from '@/hooks/use-foresight'
import { useFileIntentLifetime } from '@/lib/file-open-intent/hooks/use-file-intent-lifetime'
import { useFileIntent } from '@/lib/file-open-intent/hooks/use-file-intent'
import type { FileOpenIntentTrigger } from '@/lib/file-open-intent/state/service'
import {
  editorTabPrefetchRegistrationKey,
  editorTabFileOpenIntent,
  editorTabPrefetchTarget,
  type EditorTabPrefetchCandidate,
} from '@/features/workspace/utils/tab-prefetch'
import { FILE_SNAPSHOT_STALE_MS } from '@/lib/file-snapshot-query-cache'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'

export function useEditorTabIntentPrefetch(tab: EditorTabPrefetchCandidate) {
  const prepareFile = useFileIntent('tab')
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const target = editorTabPrefetchTarget(tab)
  const path = target?.path ?? null
  const id = target?.id ?? null
  const registrationKey = target ? editorTabPrefetchRegistrationKey(target) : null
  // useFileIntentLifetime keys cleanup on this tab, root and host preparation identity.
  const prepare = useCallback(
    (trigger: FileOpenIntentTrigger) => {
      if (!path || !rootPath || !id) return
      const intent = editorTabFileOpenIntent(rootPath, { id, path })
      return prepareFile(intent.path, trigger, { rootPath: intent.rootPath, tabId: intent.tabId })
    },
    [prepareFile, path, rootPath, id],
  )
  const lifetime = useFileIntentLifetime(prepare)
  const { element, elementRef } = useForesight<HTMLButtonElement>({
    callback: () => lifetime.begin('trajectory'),
    enabled: target !== null && rootPath !== null,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: target ? { path: target.path, rootPath, tabId: target.id } : { tabId: tab.id },
    name: registrationKey ? `editor-tab:${registrationKey}` : `editor-tab:${tab.id}:disabled`,
    reactivateAfter: FILE_SNAPSHOT_STALE_MS,
  })
  const enter = useEffectEvent(lifetime.onPointerEnter)
  const leave = useEffectEvent(lifetime.onPointerLeave)
  const focus = useEffectEvent(lifetime.onFocus)
  const blur = useEffectEvent(lifetime.onBlur)
  useEffect(() => {
    if (!element) return
    element.addEventListener('pointerenter', enter)
    element.addEventListener('pointerleave', leave)
    element.addEventListener('focus', focus)
    element.addEventListener('blur', blur)
    return () => {
      element.removeEventListener('pointerenter', enter)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('focus', focus)
      element.removeEventListener('blur', blur)
      leave()
      blur()
    }
  }, [element])
  return elementRef
}
