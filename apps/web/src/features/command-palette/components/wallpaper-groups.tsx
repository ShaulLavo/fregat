import { DesktopIcon, ProhibitIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import type { WallpaperAsset, WallpaperSource } from '@workspace/contracts'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { RowLabel } from '@/features/command-palette/components/row-label'
import { wallpaperItemValue } from '@/features/command-palette/utils/wallpapers'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { selectWallpaper, visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { useCommand } from '@/keymap/hooks/use-command'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import {
  wallpaperDisplayName,
  wallpaperSections,
  wallpaperTitle,
} from '@/lib/wallpapers/utils/groups'

function isActive(current: WallpaperSource, source: WallpaperSource) {
  if (current.kind !== source.kind) return false
  if (current.kind !== 'library' || source.kind !== 'library') return true
  return current.asset === source.asset
}

export function WallpaperGroups() {
  const library = useQuery(wallpaperLibraryOptions(), useSettingsOwner())
  const selection = useSettingValue('workbench.wallpaper')
  const { setSetting } = useSettingsActions()
  const { closePalette } = useCommand()
  const current = visibleWallpaper(selection)
  const sections = wallpaperSections(library.data?.assets ?? [])

  function choose(source: WallpaperSource) {
    setSetting(
      'workbench.wallpaper',
      selectWallpaper(selection, source),
      undefined,
      'workspace.selectWallpaper',
    )
    closePalette(true)
  }

  function assetItem(asset: WallpaperAsset, heading: string) {
    const source: WallpaperSource = { kind: 'library', asset: asset.id }
    return (
      <CommandItem
        key={asset.id}
        keywords={[wallpaperDisplayName(asset), heading, asset.name]}
        title={wallpaperTitle(asset)}
        value={wallpaperItemValue(source)}
        onSelect={() => choose(source)}
      >
        <img
          crossOrigin='anonymous'
          src={libraryImageUrl(asset.id, 'thumbnail')}
          alt=''
          className='bg-muted aspect-video h-6 shrink-0 rounded-md object-cover'
          loading='lazy'
        />
        <RowLabel label={wallpaperDisplayName(asset)} />
        {isActive(current, source) && <CommandShortcut>active</CommandShortcut>}
      </CommandItem>
    )
  }

  return (
    <>
      <CommandGroup heading='Wallpaper'>
        <CommandItem
          keywords={['none', 'off', 'plain']}
          value={wallpaperItemValue({ kind: 'none' })}
          onSelect={() => choose({ kind: 'none' })}
        >
          <ProhibitIcon className='text-muted-foreground' />
          <RowLabel label='None' />
          {current.kind === 'none' && <CommandShortcut>active</CommandShortcut>}
        </CommandItem>
        <CommandItem
          keywords={['desktop', 'system']}
          value={wallpaperItemValue({ kind: 'desktop' })}
          onSelect={() => choose({ kind: 'desktop' })}
        >
          <DesktopIcon className='text-muted-foreground' />
          <RowLabel label='Desktop' />
          {current.kind === 'desktop' && <CommandShortcut>active</CommandShortcut>}
        </CommandItem>
      </CommandGroup>
      {library.isPending ? (
        <LoadingState label='Loading wallpapers' className='px-2 py-1'>
          <div aria-hidden='true' className='skeleton-sweep h-4 w-full rounded-md' />
        </LoadingState>
      ) : null}
      {sections.uploads.length > 0 ? (
        <CommandGroup heading='Your uploads'>
          {sections.uploads.map((asset) => assetItem(asset, 'uploads'))}
        </CommandGroup>
      ) : null}
      {sections.themes.map((group) => (
        <CommandGroup key={group.id} heading={group.heading}>
          {group.assets.map((asset) => assetItem(asset, group.heading))}
        </CommandGroup>
      ))}
    </>
  )
}
