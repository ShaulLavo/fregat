import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { DesktopIcon, MagnifyingGlassIcon, ProhibitIcon, XIcon } from '@phosphor-icons/react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import type { WallpaperAsset, WallpaperSelection, WallpaperSource } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { useState, type ClipboardEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import { WallpaperCard } from '@/features/settings/components/widgets/wallpaper-card'
import { WallpaperSection } from '@/features/settings/components/widgets/wallpaper-section'
import { WallpaperSourceCard } from '@/features/settings/components/widgets/wallpaper-source-card'
import { WallpaperUploadTile } from '@/features/settings/components/widgets/wallpaper-upload-tile'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { useWallpaperActions } from '@/features/settings/hooks/use-wallpaper-actions'
import { useWallpaperUpload } from '@/features/settings/hooks/use-wallpaper-upload'
import { wallpaperMutationKeys } from '@/features/settings/utils/mutation-keys'
import { WALLPAPER_LIMITS_HINT } from '@/features/settings/utils/wallpaper-upload'
import { errorMessage } from '@/lib/error-message'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import { wallpaperSections } from '@/lib/wallpapers/utils/groups'

import { selectWallpaper, visibleWallpaper } from '@/lib/wallpapers/utils/selection'

export function WallpaperPickerDialog({
  disabled,
  value,
  onChange,
  onClose,
}: {
  readonly disabled: boolean
  readonly value: WallpaperSelection
  readonly onChange: (value: WallpaperSelection) => void
  readonly onClose: () => void
}) {
  const owner = useSettingsOwner()
  const library = useQuery(wallpaperLibraryOptions(), owner)
  const actions = useWallpaperActions()
  const uploading = useIsMutating({ mutationKey: wallpaperMutationKeys.upload }, owner) > 0
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const selection = visibleWallpaper(value)
  const select = (source: WallpaperSource) => onChange(selectWallpaper(value, source))
  const uploadFiles = useWallpaperUpload((asset) => select({ kind: 'library', asset: asset.id }))
  const sections = wallpaperSections(library.data?.assets ?? [], search)
  const filtering = search.trim().length > 0
  const nothingMatches = filtering && sections.uploads.length === 0 && sections.themes.length === 0

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    void uploadFiles([...event.dataTransfer.files])
  }

  function handlePaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.files]
    if (disabled || files.length === 0) return
    event.preventDefault()
    void uploadFiles(files)
  }

  function importOmarchy() {
    actions.importDirectory.mutate(undefined, {
      onSuccess: (result) => {
        const count = new Set(Object.values(result.themes).flat()).size
        const skipped = result.skipped.length
        toast.success(`${count} Omarchy backgrounds in the library`, {
          description: skipped > 0 ? `${skipped} could not be read and were skipped.` : undefined,
        })
      },
      onError: (error) =>
        toast.error('Omarchy backgrounds could not be imported', {
          description: errorMessage(error, 'Try again.'),
        }),
    })
  }

  function card(asset: WallpaperAsset, deletable: boolean) {
    return (
      <WallpaperCard
        key={asset.id}
        asset={asset}
        selected={selection.kind === 'library' && selection.asset === asset.id}
        disabled={disabled}
        deleting={actions.remove.isPending && actions.remove.variables === asset.id}
        onSelect={() => select({ kind: 'library', asset: asset.id })}
        onDelete={
          deletable
            ? () =>
                actions.remove.mutate(asset.id, {
                  onError: (error) =>
                    toast.error(`${asset.name} could not be deleted`, {
                      description: errorMessage(error, 'Try again.'),
                    }),
                })
            : undefined
        }
      />
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className='flex h-[min(760px,calc(100svh-2rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 text-sm sm:max-w-none'
        showCloseButton={false}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDragging(false)
        }}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>Wallpaper</DialogTitle>
          <DialogDescription>{`Choose a wallpaper for your workspace.`}</DialogDescription>
        </DialogHeader>
        <PaneBar>
          <span className='text-xs font-medium'>Wallpaper</span>
          <InputGroup className='ml-auto h-(--density-control-height-sm) w-52 shrink-0 max-sm:w-32'>
            <InputGroupAddon align='inline-start'>
              <MagnifyingGlassIcon aria-hidden='true' className='size-(--icon-size-sm)' />
            </InputGroupAddon>
            <InputGroupInput
              aria-label='Filter wallpapers'
              autoComplete='off'
              autoFocus
              className='h-full text-xs'
              placeholder='Filter'
              spellCheck={false}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </InputGroup>
          {library.data?.omarchyAvailable ? (
            <Button
              size='sm'
              variant='ghost'
              title='Copy the backgrounds of the Omarchy themes installed on this machine into the library'
              disabled={disabled || actions.importDirectory.isPending}
              onClick={importOmarchy}
            >
              {actions.importDirectory.isPending ? <OrbitLoader /> : null}
              Import Omarchy
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogClose
                  render={<Button aria-label='Close' size='icon-sm' variant='ghost' />}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </PaneBar>
        <div
          className='focus-ring-inset flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-(--density-dialog-padding)'
          tabIndex={-1}
        >
          {filtering ? null : (
            <WallpaperSection heading='Sources'>
              <WallpaperSourceCard
                label='None'
                description='A plain background with no image'
                icon={<ProhibitIcon aria-hidden='true' />}
                selected={selection.kind === 'none'}
                disabled={disabled}
                onSelect={() => select({ kind: 'none' })}
              />
              <WallpaperSourceCard
                label='Desktop'
                description='Follow the wallpaper this machine’s desktop is showing'
                icon={<DesktopIcon aria-hidden='true' />}
                selected={selection.kind === 'desktop'}
                disabled={disabled}
                onSelect={() => select({ kind: 'desktop' })}
              />
            </WallpaperSection>
          )}
          {library.isPending ? (
            <LoadingState label='Loading wallpapers'>
              <div className='bg-muted h-24 w-full rounded-md' />
            </LoadingState>
          ) : null}
          {library.isError ? (
            <EmptyState
              title='Could not load wallpapers'
              tone='error'
              action={<Button onClick={() => void library.refetch()}>Retry</Button>}
            />
          ) : null}
          {library.data && (!filtering || sections.uploads.length > 0) ? (
            <WallpaperSection heading='Your uploads' count={sections.uploads.length}>
              <WallpaperUploadTile
                disabled={disabled}
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
          {nothingMatches ? <EmptyState title='No wallpapers match' description={search} /> : null}
        </div>
        <p className='text-muted-foreground flex h-(--bar-height) shrink-0 items-center px-(--bar-padding-x) text-xs'>
          {WALLPAPER_LIMITS_HINT}
        </p>
      </DialogContent>
    </Dialog>
  )
}
