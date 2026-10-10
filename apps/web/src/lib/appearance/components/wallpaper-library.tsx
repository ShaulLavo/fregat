import { DesktopIcon, MagnifyingGlassIcon, ProhibitIcon } from '@phosphor-icons/react'
import { useIsMutating, useQueries, useQuery } from '@tanstack/react-query'
import type {
  AssetId,
  PaletteColors,
  WallpaperAsset,
  WallpaperCatalogEntry,
  WallpaperSelection,
  WallpaperSource,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { cn } from '@workspace/ui/lib/utils'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

import { errorMessage } from '@/lib/error-message'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { useWallpaperActions } from '@/lib/wallpapers/hooks/use-actions'
import { useWallpaperUpload } from '@/lib/wallpapers/hooks/use-upload'
import { wallpaperMutationKeys } from '@/lib/wallpapers/utils/mutation-keys'
import { toastError } from '@/lib/toast-error'
import { wallpaperColorsOptions, wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import { wallpaperSections } from '@/lib/wallpapers/utils/groups'
import { visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { WallpaperCard } from '@/lib/wallpapers/components/card'
import { WallpaperCatalogCard } from '@/lib/wallpapers/components/catalog-card'
import { WallpaperSection } from '@/lib/wallpapers/components/section'
import { WallpaperSourceCard } from '@/lib/wallpapers/components/source-card'
import { WallpaperUploadTile } from '@/lib/wallpapers/components/upload-tile'
import { sortByMatch } from '@/lib/wallpapers/utils/matches'

type Order = 'library' | 'matches'

/** Centers the chosen card in whichever scrollers inside `body` hold it; `body`'s host stays put. */
function revealSelected(body: HTMLElement) {
  const selected = body.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!selected) return
  const target = selected.getBoundingClientRect()
  for (let node = selected.parentElement; node; node = node.parentElement) {
    const box = node.getBoundingClientRect()
    node.scrollLeft += target.left - box.left - (box.width - target.width) / 2
    node.scrollTop += target.top - box.top - (box.height - target.height) / 2
    if (node === body) return
  }
}

/**
 * The wallpaper library: sources, uploads (drop or paste), and each theme's images. Matches sorts
 * by closeness to `colors`; with `onColorsFromImage`, the reverse is one action away.
 */
export function WallpaperLibrary({
  className,
  colors,
  strips = false,
  value,
  onChange,
  onColorsFromImage,
}: {
  className?: string
  colors: PaletteColors | null
  /**
   * Each section a sideways row at its natural height, for a host that already scrolls: a nested
   * vertical scroller would swallow the host's wheel until every wallpaper had gone by.
   */
  strips?: boolean
  value: WallpaperSelection
  onChange: (source: WallpaperSource) => void
  onColorsFromImage?: (asset: AssetId) => void
}) {
  const owner = useSettingsOwner()
  const library = useQuery(wallpaperLibraryOptions(), owner)
  const actions = useWallpaperActions()
  const uploading = useIsMutating({ mutationKey: wallpaperMutationKeys.upload }, owner) > 0
  const [search, setSearch] = useState('')
  const [order, setOrder] = useState<Order>('library')
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const selection = visibleWallpaper(value)
  const select = onChange
  const uploadFiles = useWallpaperUpload((asset) => select({ kind: 'library', asset: asset.id }))
  const assets = library.data?.assets ?? []
  const matching = order === 'matches' && colors !== null
  const colorQueries = useQueries(
    { queries: (matching ? assets : []).map((asset) => wallpaperColorsOptions(asset.id)) },
    owner,
  )
  const sections = wallpaperSections(assets, search, library.data?.catalog)
  const colorsById = new Map(
    colorQueries.flatMap((query, index) => (query.data ? [[assets[index]!.id, query.data]] : [])),
  )
  const matches =
    matching && colors
      ? sortByMatch(assets, colorsById, colors.app.background, colors.app.primary)
      : []

  // Once, when the cards first exist: the chosen one is often far past the fold.
  useEffect(() => {
    if (library.isSuccess && bodyRef.current) revealSelected(bodyRef.current)
  }, [library.isSuccess])

  function card(asset: WallpaperAsset, deletable: boolean) {
    return (
      <WallpaperCard
        key={asset.id}
        asset={asset}
        selected={selection.kind === 'library' && selection.asset === asset.id}
        disabled={false}
        deleting={actions.remove.isPending && actions.remove.variables === asset.id}
        onSelect={() => select({ kind: 'library', asset: asset.id })}
        onDelete={
          deletable
            ? () =>
                actions.remove.mutate(asset.id, {
                  onError: (error) =>
                    toastError(`${asset.name} could not be deleted`, {
                      description: errorMessage(error, 'Try again.'),
                    }),
                })
            : undefined
        }
      />
    )
  }

  function catalogCard(entry: WallpaperCatalogEntry) {
    return (
      <WallpaperCatalogCard
        key={entry.asset}
        entry={entry}
        installing={actions.install.isPending && actions.install.variables === entry.asset}
        onSelect={() =>
          actions.install.mutate(entry.asset, {
            onSuccess: (asset) => select({ kind: 'library', asset: asset.id }),
            onError: (error) =>
              toastError(`${entry.file} could not be downloaded`, {
                description: errorMessage(error, 'Try again.'),
              }),
          })
        }
      />
    )
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  function handlePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    void uploadFiles(files)
  }

  return (
    <div
      className={cn('flex flex-col gap-2', !strips && 'h-full min-h-0', className)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div className='flex shrink-0 flex-wrap items-center gap-(--density-control-gap)'>
        <InputGroup className='h-(--density-control-height-sm) w-52 shrink-0'>
          <InputGroupAddon align='inline-start'>
            <MagnifyingGlassIcon aria-hidden='true' className='size-(--icon-size-sm)' />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Filter wallpapers'
            autoComplete='off'
            className='h-full text-xs'
            placeholder='Filter'
            spellCheck={false}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </InputGroup>
        <Tabs className='shrink-0' value={order} onValueChange={(next: Order) => setOrder(next)}>
          <TabsList aria-label='Order' variant='segmented'>
            <TabsTab value='library'>Library</TabsTab>
            <TabsTab value='matches'>Matches</TabsTab>
          </TabsList>
        </Tabs>
        {matching && colorQueries.some((query) => query.isPending) ? (
          <Spinner label='Reading wallpaper colors' size='xs' />
        ) : null}
        <span className='min-w-0 flex-1' />
        {onColorsFromImage ? (
          <Button
            disabled={selection.kind !== 'library'}
            size='sm'
            variant='outline'
            onClick={() => {
              if (selection.kind === 'library') onColorsFromImage(selection.asset)
            }}
          >
            Colors from this image
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          'flex flex-col gap-3',
          !strips && 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        )}
        ref={bodyRef}
      >
        {library.isPending ? (
          <LoadingState label='Loading wallpapers'>
            <div className='bg-muted h-20 w-full rounded-md' />
          </LoadingState>
        ) : null}
        {matching ? (
          <WallpaperSection heading='Closest to these colors' count={matches.length} strip={strips}>
            {matches.map((asset) => card(asset, false))}
          </WallpaperSection>
        ) : (
          <>
            {search.trim() ? null : (
              <WallpaperSection heading='Sources' strip={strips}>
                <WallpaperSourceCard
                  label='None'
                  description='A plain background with no image'
                  icon={<ProhibitIcon aria-hidden='true' />}
                  selected={selection.kind === 'none'}
                  disabled={false}
                  onSelect={() => select({ kind: 'none' })}
                />
                <WallpaperSourceCard
                  label='Desktop'
                  description='Follow the wallpaper this machine’s desktop is showing'
                  icon={<DesktopIcon aria-hidden='true' />}
                  selected={selection.kind === 'desktop'}
                  disabled={false}
                  onSelect={() => select({ kind: 'desktop' })}
                />
              </WallpaperSection>
            )}
            {library.data ? (
              <WallpaperSection
                heading='Your uploads'
                count={sections.uploads.length}
                strip={strips}
              >
                <WallpaperUploadTile
                  disabled={false}
                  uploading={uploading}
                  dragging={dragging}
                  onFiles={(files) => void uploadFiles(files)}
                />
                {sections.uploads.map((asset) => card(asset, true))}
              </WallpaperSection>
            ) : null}
            {sections.themes.map((group) => (
              <WallpaperSection
                key={group.id}
                heading={group.heading}
                count={group.assets.length + group.catalog.length}
                strip={strips}
              >
                {group.assets.map((asset) => card(asset, false))}
                {group.catalog.map(catalogCard)}
              </WallpaperSection>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
