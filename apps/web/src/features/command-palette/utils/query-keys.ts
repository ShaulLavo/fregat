export const paletteQueryKeys = {
  contentModule: ['command-palette', 'content-module'] as const,
  scripts: (rootPath: string) => ['command-palette', 'scripts', rootPath] as const,
}
