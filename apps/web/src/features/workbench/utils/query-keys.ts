export const csvEngineQueryKeys = {
  engine: () => ['workbench', 'csv-engine'] as const,
}

export const wallpaperQueryKeys = {
  all: ['wallpaper'] as const,
  info: () => [...wallpaperQueryKeys.all, 'info'] as const,
  media: () => [...wallpaperQueryKeys.all, 'media'] as const,
}

export const projectMenuQueryKeys = {
  canonicalRoots: (paths: readonly string[]) => ['project-menu', 'canonical-roots', paths] as const,
  checkouts: (path: string) => ['project-menu', 'checkouts', path] as const,
}

export const pagedFileQueryKeys = {
  facts: (path: string, version: string | null) =>
    ['workbench', 'file-facts', path, version] as const,
  limits: (path: string) => ['workbench', 'file-limit', path] as const,
  instance: (instance: string, path: string, generation: number) =>
    ['workbench', 'paged-file', instance, path, generation] as const,
  resource: (instance: string, path: string, generation: number) =>
    [...pagedFileQueryKeys.instance(instance, path, generation), 'resource'] as const,
  index: (id: string) => ['workbench', 'paged-index', id] as const,
  pages: (id: string) => ['workbench', 'paged-page', id] as const,
  page: (id: string, line: number) => ['workbench', 'paged-page', id, line] as const,
}
