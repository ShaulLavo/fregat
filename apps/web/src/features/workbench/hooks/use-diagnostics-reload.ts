import { useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LanguageServerDiagnosticSummary } from '@singapore-editor/lsp-plugin/websocket'
import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import {
  captureDiagnostics,
  captureDiagnosticsScroll,
  diagnosticsReloadOwner,
  savedDiagnostics,
  subscribeDiagnosticsReload,
} from '@/features/workbench/state/diagnostics-reload'

export function useDiagnosticsReload(
  sourcePath: string | undefined,
  summary: LanguageServerDiagnosticSummary | null,
) {
  const owner = useQueryClient()
  const documents = useEditorDocumentStoreApi()
  const target = useSyncExternalStore(
    subscribeDiagnosticsReload,
    () => diagnosticsReloadOwner(owner),
    () => diagnosticsReloadOwner(owner),
  )
  const selected = useEditorWorkspaceState((state) => state.selectedTabContent)
  const path = tabFileResource(selected)?.path ?? null
  const document = useEditorDocumentState((state) =>
    path ? state.liveDocumentsByKey[fileDocumentKey(path)] : undefined,
  )
  const revision = document?.sync.kind === 'file' ? document.sync.fileVersion : null
  const changed = Boolean(document && (document.buffer.isDirty() || document.sync.kind !== 'file'))
  const saved = savedDiagnostics(owner, path, revision, changed, target)
  const live = sourcePath === path ? summary : null
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const ready = Boolean(live ?? saved?.summary)
  const observed = useRef({ summary: live, revision })
  useLayoutEffect(() => {
    if (observed.current.summary !== live) observed.current = { summary: live, revision }
  }, [live, revision])
  const restoredScroll = useEffectEvent(() => saved?.scrollTop ?? 0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !ready) return
    scroll.current = restoredScroll()
    node.scrollTop = scroll.current
    const remember = () => {
      scroll.current = node.scrollTop
    }
    node.addEventListener('scroll', remember)
    return () => node.removeEventListener('scroll', remember)
  }, [path, ready])
  useLayoutEffect(() => {
    if (!path || changed) return
    const capture = () => {
      if (diagnosticsReloadOwner(owner) !== target) return
      const current = documents.getState().liveDocumentsByKey[fileDocumentKey(path)]
      if (current && (current.buffer.isDirty() || current.sync.kind !== 'file')) return
      if (!live) {
        const currentRevision = current?.sync.kind === 'file' ? current.sync.fileVersion : null
        if (savedDiagnostics(owner, path, currentRevision, false, target))
          captureDiagnosticsScroll(owner, target, path, scroll.current)
        return
      }
      if (!current || current.sync.kind !== 'file' || !revision) return
      if (current.sync.fileVersion !== revision || observed.current.revision !== revision) return
      captureDiagnostics(owner, target, path, revision, live, scroll.current)
    }
    capture()
    const remove = addLifecycleFlush(capture)
    return () => {
      capture()
      remove()
    }
  }, [owner, target, path, revision, live, changed, documents])
  return { path, diagnostics: live ?? saved?.summary ?? null, saved: !live && Boolean(saved), ref }
}
