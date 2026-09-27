import { CloudArrowDownIcon } from '@phosphor-icons/react'
import type { WallpaperCatalogEntry } from '@workspace/contracts'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'
import { WallpaperChoice } from '@/lib/wallpapers/components/choice'
import { catalogDisplayName } from '@/lib/wallpapers/utils/groups'

/** An Omarchy wallpaper still on GitHub; picking it downloads it into the library. */
export function WallpaperCatalogCard({
  entry,
  installing,
  onSelect,
}: {
  readonly entry: WallpaperCatalogEntry
  readonly installing: boolean
  readonly onSelect: () => void
}) {
  const [failed, setFailed] = useState(false)
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
        {failed ? (
          <span className='bg-muted aspect-video w-full rounded-md' />
        ) : (
          <img
            src={entry.source}
            alt=''
            className='bg-muted aspect-video w-full rounded-md object-cover'
            loading='lazy'
            onError={() => setFailed(true)}
          />
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
