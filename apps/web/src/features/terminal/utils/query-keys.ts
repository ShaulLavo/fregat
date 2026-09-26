export const terminalQueryKeys = {
  runtime: ['terminal', 'runtime'] as const,
  panelModule: ['terminal', 'panel-module'] as const,
  checkout: (rootPath: string) => ['terminal', 'checkout', rootPath] as const,
}
