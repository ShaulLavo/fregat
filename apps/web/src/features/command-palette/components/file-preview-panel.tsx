import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { use, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { useSettingValue } from '@/hooks/use-setting-value'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { FileOpenIntentContext } from '@/lib/file-open-intent/providers/context'
import { FileThumbnail } from '@/lib/file-preview/components/file-thumbnail'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { imageReadyQueryOptions } from '@/lib/file-preview/utils/image-ready-query'
import { isImageName, PREVIEW_SETTLE_MS, previewImageUrl } from '@/lib/file-preview/utils/preview'
import {
  previewViewMutationOptions,
  samePreviewScope,
  type PreviewViewRead,
  type PreviewSourceLease,
} from '@/lib/file-preview/utils/source'
import type { FilePaletteItem } from '@/features/command-palette/utils/types'

type ShownPreview = {
  item: FilePaletteItem
  origin: string
  read: PreviewViewRead
  lease: PreviewSourceLease | null
  controller: AbortController | null
}

export function FilePreviewPanel({ item }: { readonly item: FilePaletteItem | null }) {
  const [settled] = useDebouncedValue(item, { wait: PREVIEW_SETTLE_MS })
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const maxBytes = useSettingValue('files.previewKilobytes') * 1024
  const capability = use(FileOpenIntentContext)?.previewSource ?? null
  const application = useApplicationRuntime()
  const store = capability?.store ?? application.getSnapshot().editor.documentStore
  const ownerScope = useStore(store, (state) => state.previewScope)
  const scope = capability?.origin === origin ? ownerScope : null
  const [shown, setShown] = useState<ShownPreview | null>(null)
  const pending = useRef<AbortController | null>(null)
  const adoption = useMutation(previewViewMutationOptions(capability, queryClient))
  const read = useStore(store, (state) =>
    shown?.lease ? (state.previewSources.get(shown.lease) ?? shown.lease.read()) : null,
  )
  const isImage = isImageName(settled?.entry.name ?? '')
  const image = useQuery({
    ...imageReadyQueryOptions(previewImageUrl(serverEndpoint(origin), settled?.entry.path ?? '')),
    enabled: settled !== null && isImage,
  })

  const start = useEffectEvent((controller: AbortController) => {
    if (!settled) return
    pending.current = controller
    adoption.mutate(
      { path: settled.entry.path, maxBytes, scope, signal: controller.signal },
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
          setShown({ item: settled, origin, read: binding.read, lease: binding.lease, controller })
        },
        onError: (error) => {
          if (pending.current !== controller || controller.signal.aborted) return
          pending.current = null
          setShown({
            item: settled,
            origin,
            read: { kind: 'error', error },
            lease: null,
            controller,
          })
        },
      },
    )
  })
  if (!settled && shown) setShown(null)
  if (
    settled &&
    isImage &&
    !image.isPending &&
    (shown?.item !== settled || shown.origin !== origin)
  )
    setShown({ item: settled, origin, read: { kind: 'other' }, lease: null, controller: null })
  useLayoutEffect(() => {
    if (!settled || isImage) return
    const controller = new AbortController()
    start(controller)
    return () => {
      if (pending.current !== controller) return
      pending.current = null
      controller.abort()
    }
  }, [settled, origin, maxBytes, scope, capability, queryClient, isImage, image.isPending])
  useLayoutEffect(
    () => () => {
      shown?.controller?.abort()
      shown?.lease?.release()
    },
    [shown],
  )

  const display =
    shown ??
    (settled
      ? { item: settled, origin, read: { kind: 'pending' } as const, lease: null, controller: null }
      : null)
  if (!display) return null
  const { entry } = display.item
  const fetching = display.item !== item || adoption.isPending || image.isFetching
  const fallback = <p className='text-muted-foreground p-2 text-xs'>Preview unavailable</p>
  return (
    <section
      aria-label='File preview'
      className='flex max-h-[35dvh] shrink-0 flex-col overflow-hidden px-3 pb-3'
      data-file-preview={entry.path}
      title={display.item.pathLabel}
    >
      <PaneBar as='header'>
        <span
          className='min-w-0 flex-1 truncate text-xs font-medium'
          title={display.item.pathLabel}
        >
          {entry.name}
        </span>
        {fetching ? <Spinner label='Loading preview' size='xs' /> : null}
      </PaneBar>
      {isImageName(entry.name) ? (
        <FileThumbnail
          fallback={fallback}
          src={previewImageUrl(serverEndpoint(display.origin), entry.path)}
        />
      ) : (
        <TextPreview fallback={fallback} name={entry.name} read={read ?? display.read} />
      )}
    </section>
  )
}
