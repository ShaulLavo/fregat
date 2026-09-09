import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { WebWallpaper } from '@/features/workbench/components/web-wallpaper'
import { documentBackdrop } from '@/lib/platform/backdrop'

// Only a window with nothing behind it needs a wallpaper of its own. A macOS
// NSVisualEffectView and a Linux compositor both already put the live desktop
// back there — drawing over it would cover up the thing we want, at the cost of
// a permanent full-screen video decode in the animated case. What is behind the
// window is the shell's to report; in a browser, and in an opaque macOS shell
// window, nothing is, and the web layer has to draw it.
export function Wallpaper({ className }: { readonly className?: string }) {
  // The `data-wallpaper-hidden` attribute that switches off the popover vibrancy
  // layer is written by `applyAppearance`, alongside the other appearance
  // settings — two writers for one attribute is how it would end up disagreeing
  // with itself. This component owns only whether the media is mounted.
  const enabled = useSettingValue('workbench.wallpaper.enabled')

  // Unmounting is the point: hiding it with CSS would leave the video decoding.
  if (!enabled) return null
  if (documentBackdrop() !== 'app') return null

  return <WebWallpaper className={className} />
}
