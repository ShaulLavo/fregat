import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { LibraryWallpaper } from '@/features/workbench/components/library-wallpaper'
import { WebWallpaper } from '@/features/workbench/components/web-wallpaper'
import { documentBackdrop } from '@/lib/platform/backdrop'

export function Wallpaper({ className }: { readonly className?: string }) {
  const selection = useSettingValue('workbench.wallpaper')
  const { resolvedTheme } = useTheme()
  const source = selection[resolvedTheme]
  const backdrop = documentBackdrop()
  if (source.kind === 'none' || backdrop === 'transparent') return null
  if (source.kind === 'library')
    return <LibraryWallpaper asset={source.asset} className={className} key={source.asset} />
  if (backdrop !== 'app') return null
  return <WebWallpaper className={className} />
}
