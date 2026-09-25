import { DesktopIcon, MagnifyingGlassIcon, ProhibitIcon } from '@phosphor-icons/react'
import { useIsMutating, useQueries, useQuery } from '@tanstack/react-query'
import type {
  AssetId,
  PaletteColors,
  WallpaperAsset,
  WallpaperSelection,
  WallpaperSource,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { useState, type ClipboardEvent, type DragEvent } from 'react'

import { errorMessage } from '@/lib/error-message'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { useWallpaperActions } from '@/lib/theme-library/hooks/use-wallpaper-actions'
import { useWallpaperUpload } from '@/lib/theme-library/hooks/use-wallpaper-upload'
import { wallpaperMutationKeys } from '@/lib/theme-library/utils/keys'
import { toastError } from '@/lib/toast-error'
import { wallpaperColorsOptions, wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import { wallpaperSections } from '@/lib/wallpapers/utils/groups'
import { selectWallpaper, visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { WallpaperCard } from '@/features/theme-studio/components/wallpaper-card'
import { WallpaperSection } from '@/features/theme-studio/components/wallpaper-section'
import { WallpaperSourceCard } from '@/features/theme-studio/components/wallpaper-source-card'
import { WallpaperUploadTile } from '@/features/theme-studio/components/wallpaper-upload-tile'
import { sortByMatch } from '@/features/theme-studio/utils/wallpaper-matches'

type Order = 'library' | 'matches'

/**
 * The wallpaper library for the half on screen: sources, uploads (drop or paste), and each theme's
 * images. Matches sorts by closeness to the draft's colors; the reverse, colors from an image,
 * is one action away.
 */
export function WallpaperTab({
  colors,
  value,
  onChange,
  onColorsFromImage,
}: {
  colors: PaletteColors | null
  value: WallpaperSelection
  onChange: (value: WallpaperSelection) => void
  onColorsFromImage: (asset: AssetId) => void
}) {
  const owner = useSettingsOwner()
  const library = useQuery(wallpaperLibraryOptions(), owner)
  const actions = useWallpaperActions()
  const uploading = useIsMutating({ mutationKey: wallpaperMutationKeys.upload }, owner) > 0
  const [search, setSearch] = useState('')
  const [order, setOrder] = useState<Order>('library')
  const [dragging, setDragging] = useState(false)
  const selection = visibleWallpaper(value)
  const select = (source: WallpaperSource) => onChange(selectWallpaper(value, source))
  const uploadFiles = useWallpaperUpload((asset) => select({ kind: 'library', asset: asset.id }))
  const assets = library.data?.assets ?? []
  const matching = order === 'matches' && colors !== null
  const colorQueries = useQueries(
    { queries: (matching ? assets : []).map((asset) => wallpaperColorsOptions(asset.id)) },
    owner,
  )
  const sections = wallpaperSections(assets, search)
  const colorsById = new Map(
    colorQueries.flatMap((query, index) => (query.data ? [[assets[index]!.id, query.data]] : [])),
  )
  const matches =
    matching && colors
      ? sortByMatch(assets, colorsById, colors.app.background, colors.app.primary)
      : []

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

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void uploadFiles([...event.dataTransfer.files])
  }

  function handlePaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.files]
    if (files.length === 0) return
    event.preventDefault()
    void uploadFiles(files)
  }

  return (
    <div
      className='flex h-full min-h-0 flex-col gap-2 px-(--bar-padding-x) py-(--density-section-gap)'
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
      <div className='flex shrink-0 items-center gap-(--density-control-gap)'>
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
        <Tabs value={order} onValueChange={(next: Order) => setOrder(next)}>
          <TabsList aria-label='Order' variant='segmented'>
            <TabsTab value='library'>Library</TabsTab>
            <TabsTab value='matches'>Matches</TabsTab>
          </TabsList>
        </Tabs>
        {matching && colorQueries.some((query) => query.isPending) ? (
          <Spinner label='Reading wallpaper colors' size='xs' />
        ) : null}
        <span className='min-w-0 flex-1' />
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
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain'>
        {library.isPending ? (
          <LoadingState label='Loading wallpapers'>
            <div className='bg-muted h-20 w-full rounded-md' />
          </LoadingState>
        ) : null}
        {matching ? (
          <WallpaperSection heading='Closest to these colors' count={matches.length}>
            {matches.map((asset) => card(asset, false))}
          </WallpaperSection>
        ) : (
          <>
            {search.trim() ? null : (
              <WallpaperSection heading='Sources'>
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
              <WallpaperSection heading='Your uploads' count={sections.uploads.length}>
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
              <WallpaperSection key={group.id} heading={group.heading} count={group.assets.length}>
                {group.assets.map((asset) => card(asset, false))}
              </WallpaperSection>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
