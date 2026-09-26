import { CloudArrowDownIcon } from '@phosphor-icons/react'
import type { WallpaperCatalogEntry } from '@workspace/contracts'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'
import { WallpaperChoice } from '@/features/theme-studio/components/wallpaper-choice'
import { catalogPreviewUrl } from '@/features/theme-studio/utils/catalog-preview'
import { catalogDisplayName } from '@/lib/wallpapers/utils/groups'

/** An Omarchy wallpaper still on GitHub; picking it downloads it into the library. */
export function WallpaperCatalogCard({
  entry,
  cloud,
  installing,
  onSelect,
}: {
  readonly entry: WallpaperCatalogEntry
  readonly cloud: string
  readonly installing: boolean
  readonly onSelect: () => void
}) {
  // A cloud without fetch mode enabled answers 401: fall back to the GitHub original, then a plain tile.
  const [failures, setFailures] = useState(0)
  const sources = cloud ? [catalogPreviewUrl(entry.source, cloud), entry.source] : [entry.source]
  const src = sources[failures]
  return (
    <div className='relative min-w-0'>
      <WallpaperChoice
        label={catalogDisplayName(entry)}
        title={`${entry.theme} · ${entry.file} · downloads from GitHub`}
        ariaLabel={`Download and select ${entry.theme} ${entry.file}`}
        selected={false}
        disabled={installing}
        onSelect={onSelect}
      >
        {src ? (
          <img
            src={src}
            alt=''
            className='bg-muted aspect-video w-full rounded-md object-cover'
            loading='lazy'
            onError={() => setFailures((count) => count + 1)}
          />
        ) : (
          <span className='bg-muted aspect-video w-full rounded-md' />
        )}
      </WallpaperChoice>
      <span className='bg-background text-muted-foreground pointer-events-none absolute top-2 right-2 flex size-5 items-center justify-center rounded-full'>
        {installing ? (
          <Spinner size='xs' label={`Downloading ${entry.file}`} />
        ) : (
          <CloudArrowDownIcon aria-hidden='true' className='size-(--icon-size-sm)' />
        )}
      </span>
    </div>
  )
}
