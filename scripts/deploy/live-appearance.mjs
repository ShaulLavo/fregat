export function inspectAppearance() {
  const bootstrap = window.platformHtmlBootstrap?.value
  if (bootstrap?.kind !== 'app') return { kind: bootstrap?.kind ?? null }
  let mode = bootstrap.colorMode
  if (mode === 'system')
    mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const preloads = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')]
    .filter((link) => !link.media || window.matchMedia(link.media).matches)
    .map((link) => ({
      href: link.href,
      crossOrigin: link.crossOrigin,
      imageSource: link.platformWallpaperImage?.src ?? null,
    }))
  return { kind: 'app', image: bootstrap.variants[mode].image, preloads }
}

export function appearanceFailures(appearance) {
  if (appearance.kind !== 'app') return ['the authorized HTML bootstrap was not consumed']
  if (!appearance.image)
    return appearance.preloads.length === 0
      ? []
      : ['wallpaper is disabled but an image preload is active']
  if (appearance.preloads.length !== 1)
    return [`active wallpaper preloads: ${appearance.preloads.length}, expected 1`]
  const [preload] = appearance.preloads
  const failures = []
  if (preload.href !== appearance.image.href)
    failures.push('the wallpaper preload does not match the HTML bootstrap')
  if (preload.crossOrigin !== appearance.image.crossOrigin)
    failures.push('the wallpaper preload uses a different request mode')
  if (preload.imageSource !== appearance.image.href)
    failures.push('the boot image did not adopt the wallpaper preload')
  return failures
}
