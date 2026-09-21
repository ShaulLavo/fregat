export const terminalQueryKeys = {
  panelModule: ['terminal', 'panel-module'] as const,
  checkout: (rootPath: string) => ['terminal', 'checkout', rootPath] as const,
}
