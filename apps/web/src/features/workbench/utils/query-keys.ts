export const wallpaperQueryKeys = {
  all: ['wallpaper'] as const,
  info: () => [...wallpaperQueryKeys.all, 'info'] as const,
  media: () => [...wallpaperQueryKeys.all, 'media'] as const,
}

export const projectMenuQueryKeys = {
  canonicalRoots: (paths: readonly string[]) => ['project-menu', 'canonical-roots', paths] as const,
  checkouts: (path: string) => ['project-menu', 'checkouts', path] as const,
}
