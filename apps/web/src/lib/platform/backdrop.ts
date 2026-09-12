import { getPlatformBridge } from '@/lib/platform/bridge'

/**
 * What is behind the page.
 *
 * - `app` — nothing is. A browser on a desktop that hands each window an opaque
 *   rectangle, and the shell while its window is opaque on such a desktop: the
 *   web layer draws the wallpaper and paints the solid floor.
 * - `compositor` — the window is opaque, but the window manager composites it
 *   over the real desktop and fades or blurs it there. Linux out of the box,
 *   for a shell window and a browser tab alike. The floor stays solid — an
 *   opaque window has to paint one — and a wallpaper of ours would only cover
 *   up the user's.
 * - `transparent` — the window itself is see-through, so the desktop is behind
 *   every translucent pane. No wallpaper, and no floor: painting one would hide
 *   exactly what the transparency is for. Only a shell can arrange this.
 */
export type ShellBackdrop = 'app' | 'compositor' | 'transparent'

const BACKDROP_ATTRIBUTE = 'data-backdrop'

export function applyBackdrop(backdrop: ShellBackdrop) {
  document.documentElement.setAttribute(BACKDROP_ATTRIBUTE, backdrop)
}

export function resolveBackdrop(): ShellBackdrop {
  return backdropFor(getPlatformBridge()?.backdrop ?? null, compositesOverDesktop())
}

/**
 * Two sources, each authoritative about a different thing. Only the shell knows
 * whether it built a see-through window, so `transparent` is its call alone.
 * Whether a compositor is putting the desktop behind an opaque window is a
 * property of the machine, and holds for a browser tab as much as for the
 * shell — so either source claiming it is enough, and `app` is what is left
 * when neither does. Ties break away from `app` on purpose: painting our
 * wallpaper over the user's desktop is the one outcome we cannot take back.
 */
export function backdropFor(
  reported: ShellBackdrop | null,
  hostCompositesOverDesktop: boolean,
): ShellBackdrop {
  if (reported === 'transparent') return 'transparent'
  if (reported === 'compositor' || hostCompositesOverDesktop) return 'compositor'

  return 'app'
}

// Read back off the document rather than resolving again, so the stylesheet and
// the render tree can never disagree about which mode we are in.
export function documentBackdrop(): ShellBackdrop {
  if (typeof document === 'undefined') return 'app'

  const backdrop = document.documentElement.getAttribute(BACKDROP_ATTRIBUTE)
  if (backdrop === 'compositor' || backdrop === 'transparent') return backdrop

  return 'app'
}

/**
 * The compositor that blends this window is the one on the machine showing it,
 * not the one the server runs on — a browser tab on a Linux desktop sits over
 * the same wallpaper the shell would, even when the server is somewhere else.
 * So this asks the client, and only the client.
 */
function compositesOverDesktop(): boolean {
  if (typeof navigator === 'undefined') return false

  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform
  if (platform) return platform === 'Linux'

  // Android says "Linux" too, and a phone has no desktop behind the window.
  if (/android/i.test(navigator.userAgent)) return false

  return /linux|bsd/i.test(navigator.userAgent)
}
