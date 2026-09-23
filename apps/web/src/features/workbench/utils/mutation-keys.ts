export const workbenchMutationKeys = {
  createMissingFile: (path: string) => ['workbench', 'create-missing-file', path] as const,
}
