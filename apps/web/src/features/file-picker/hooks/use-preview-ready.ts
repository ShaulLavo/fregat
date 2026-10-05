import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { use, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { useSettingValue } from '@/hooks/use-setting-value'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { FileOpenIntentContext } from '@/lib/file-open-intent/providers/context'
import {
  previewViewMutationOptions,
  samePreviewScope,
  type PreviewViewRead,
  type PreviewSourceLease,
} from '@/lib/file-preview/utils/source'
import { previewImageUrl } from '@/lib/file-preview/utils/preview'
import type { FsEntry } from '@/lib/file-system-types'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { imageReadyQueryOptions } from '@/lib/file-preview/utils/image-ready-query'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { previewKind } from '@/features/file-picker/utils/preview'

type ShownEntry = {
  entry: FsEntry
  origin: string
  read: PreviewViewRead
  lease: PreviewSourceLease | null
  controller: AbortController | null
}

export function usePreviewReady(
  entry: FsEntry | null,
  { mode, showHidden }: { mode: FilePickerMode; showHidden: boolean },
) {
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const maxBytes = useSettingValue('files.previewKilobytes') * 1024
  const capability = use(FileOpenIntentContext)?.previewSource ?? null
  const application = useApplicationRuntime()
  const store = capability?.store ?? application.getSnapshot().editor.documentStore
  const ownerScope = useStore(store, (state) => state.previewScope)
  const scope = capability?.origin === origin ? ownerScope : null
  const [shown, setShown] = useState<ShownEntry | null>(null)
  const pending = useRef<AbortController | null>(null)
  const adoption = useMutation(previewViewMutationOptions(capability, queryClient))
  const read = useStore(store, (state) =>
    shown?.lease ? (state.previewSources.get(shown.lease) ?? shown.lease.read()) : null,
  )
  const kind = entry ? previewKind(entry) : 'none'
  const path = entry?.path ?? ''
  const folder = useQuery({
    ...directoryQueryOptions({ mode, path, query: '', showHidden }),
    enabled: kind === 'folder',
  })
  const image = useQuery({
    ...imageReadyQueryOptions(previewImageUrl(serverEndpoint(origin), path)),
    enabled: kind === 'image',
  })
  const ready = kind === 'folder' ? !folder.isPending : kind === 'image' ? !image.isPending : true
  const start = useEffectEvent((controller: AbortController) => {
    if (!entry) return
    pending.current = controller
    adoption.mutate(
      { path: entry.path, maxBytes, scope, signal: controller.signal },
      {
        onSuccess: (binding) => {
          if (
            pending.current !== controller ||
            controller.signal.aborted ||
            (scope && !samePreviewScope(capability?.store.getState().previewScope ?? null, scope))
          ) {
            binding.lease?.release()
            return
          }
          pending.current = null
          setShown({ entry, origin, read: binding.read, lease: binding.lease, controller })
        },
        onError: (error) => {
          if (pending.current !== controller || controller.signal.aborted) return
          pending.current = null
          setShown({ entry, origin, read: { kind: 'error', error }, lease: null, controller })
        },
      },
    )
  })
  if (!entry && shown) setShown(null)
  if (entry && kind !== 'text' && ready && (shown?.entry !== entry || shown.origin !== origin))
    setShown({ entry, origin, read: { kind: 'other' }, lease: null, controller: null })
  useLayoutEffect(() => {
    if (!entry || kind !== 'text') return
    const controller = new AbortController()
    start(controller)
    return () => {
      if (pending.current !== controller) return
      pending.current = null
      controller.abort()
    }
  }, [entry, origin, maxBytes, scope, capability, queryClient, kind, ready])
  useLayoutEffect(
    () => () => {
      shown?.controller?.abort()
      shown?.lease?.release()
    },
    [shown],
  )
  const display =
    shown ??
    (entry
      ? { entry, origin, read: { kind: 'pending' } as const, lease: null, controller: null }
      : null)
  return {
    shown: display ? { ...display, read: read ?? display.read } : null,
    fetching: shown?.entry !== entry || adoption.isPending || folder.isFetching || image.isFetching,
  }
}
