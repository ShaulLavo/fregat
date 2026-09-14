import { useQuery } from '@tanstack/react-query'
import type { WallpaperSelection, WallpaperSource } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'
import { toast } from 'sonner'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { useWallpaperActions } from '@/features/settings/hooks/use-wallpaper-actions'
import { WallpaperCard } from '@/features/settings/components/widgets/wallpaper-card'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import { errorMessage } from '@/lib/error-message'

export function WallpaperWidget({
  disabled,
  value,
  onChange,
}: {
  readonly disabled: boolean
  readonly value: WallpaperSelection
  readonly onChange: (value: WallpaperSelection) => void
}) {
  const owner = useSettingsOwner()
  const library = useQuery(wallpaperLibraryOptions(), owner)
  const actions = useWallpaperActions()
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const select = (source: WallpaperSource) => onChange({ ...value, [mode]: source })
  const onError = (error: unknown) =>
    toast.error('Wallpaper could not be saved', { description: errorMessage(error, 'Try again.') })
  const selection = value[mode]
  return (
    <div
      className='flex w-full min-w-0 flex-col gap-(--density-control-gap)'
      aria-label='Wallpaper picker'
    >
      <div className='flex gap-2' role='group' aria-label='Wallpaper mode'>
        <Button
          size='sm'
          variant='outline'
          className='aria-pressed:bg-accent'
          aria-pressed={mode === 'light'}
          onClick={() => setMode('light')}
        >
          Light
        </Button>
        <Button
          size='sm'
          variant='outline'
          className='aria-pressed:bg-accent'
          aria-pressed={mode === 'dark'}
          onClick={() => setMode('dark')}
        >
          Dark
        </Button>
      </div>
      <div className='flex gap-2' role='group' aria-label={`${mode} wallpaper source`}>
        <Button
          size='sm'
          variant='outline'
          className='aria-pressed:bg-accent'
          disabled={disabled}
          aria-pressed={selection.kind === 'none'}
          onClick={() => select({ kind: 'none' })}
        >
          None
        </Button>
        <Button
          size='sm'
          variant='outline'
          className='aria-pressed:bg-accent'
          disabled={disabled}
          aria-pressed={selection.kind === 'desktop'}
          onClick={() => select({ kind: 'desktop' })}
        >
          Desktop
        </Button>
      </div>
      <label className='flex flex-col gap-1 text-xs'>
        Upload wallpaper
        <Input
          type='file'
          accept='image/jpeg,image/png,image/webp'
          disabled={disabled || actions.upload.isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) actions.upload.mutate(file, { onError })
            event.currentTarget.value = ''
          }}
        />
      </label>
      {actions.upload.isPending ? <Spinner /> : null}
      {library.data?.omarchyAvailable ? (
        <Button
          size='sm'
          variant='outline'
          disabled={disabled || actions.importDirectory.isPending}
          onClick={() => actions.importDirectory.mutate(undefined, { onError })}
        >
          {actions.importDirectory.isPending ? <Spinner /> : null}Import from Omarchy
        </Button>
      ) : null}
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
      {library.data?.assets.length === 0 ? (
        <EmptyState
          title='No wallpapers yet'
          description='Upload a still image or import your Omarchy backgrounds.'
        />
      ) : null}
      <div
        className='focus-ring-inset grid max-h-96 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 overflow-y-auto'
        tabIndex={0}
        aria-label={`${mode} wallpaper library`}
      >
        {library.data?.assets.map((asset) => (
          <WallpaperCard
            key={asset.id}
            asset={asset}
            selected={selection.kind === 'library' && selection.asset === asset.id}
            disabled={disabled}
            deleting={actions.remove.isPending && actions.remove.variables === asset.id}
            onSelect={() => select({ kind: 'library', asset: asset.id })}
            onDelete={() => actions.remove.mutate(asset.id, { onError })}
          />
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        JPEG, PNG or WebP stills. Up to 20 MiB and 40 megapixels.
      </p>
    </div>
  )
}
