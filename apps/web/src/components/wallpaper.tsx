import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { LibraryWallpaper } from '@/components/library-wallpaper'
import { WebWallpaper } from '@/components/web-wallpaper'
import { documentBackdrop } from '@/lib/platform/backdrop'
import { useWallpaperPreviewStore } from '@/lib/wallpapers/state/preview-store'

export function Wallpaper({ className }: { readonly className?: string }) {
  const settings = useSettingsDocument()
  const selection = useSettingValue('workbench.wallpaper')
  const preview = useWallpaperPreviewStore((state) => state.source)
  const source = preview ?? visibleWallpaper(selection)
  const backdrop = documentBackdrop()
  if (!settings.data || source.kind === 'none' || backdrop === 'transparent') return null
  if (source.kind === 'library')
    return <LibraryWallpaper asset={source.asset} className={className} />
  if (backdrop !== 'app') return null
  return <WebWallpaper className={className} />
}
