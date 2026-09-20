export const wallpaperQueryKeys = {
  all: ['wallpaper'] as const,
  info: () => [...wallpaperQueryKeys.all, 'info'] as const,
  media: () => [...wallpaperQueryKeys.all, 'media'] as const,
}

export const projectMenuQueryKeys = {
  canonicalRoot: (path: string) => ['project-menu', 'canonical-root', path] as const,
}
