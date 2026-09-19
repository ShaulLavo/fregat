import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { LibraryWallpaper } from '@/features/workbench/components/library-wallpaper'
import { WebWallpaper } from '@/features/workbench/components/web-wallpaper'
import { documentBackdrop } from '@/lib/platform/backdrop'
import { useWallpaperPreviewStore } from '@/lib/wallpapers/state/preview-store'

export function Wallpaper({ className }: { readonly className?: string }) {
  const selection = useSettingValue('workbench.wallpaper')
  const preview = useWallpaperPreviewStore((state) => state.source)
  const source = preview ?? visibleWallpaper(selection)
  const backdrop = documentBackdrop()
  if (source.kind === 'none' || backdrop === 'transparent') return null
  if (source.kind === 'library')
    return <LibraryWallpaper asset={source.asset} className={className} key={source.asset} />
  if (backdrop !== 'app') return null
  return <WebWallpaper className={className} />
}
