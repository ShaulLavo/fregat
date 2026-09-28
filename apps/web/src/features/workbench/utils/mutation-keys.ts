export const workbenchMutationKeys = {
  releaseReadSession: (id: string) => ['workbench', 'release-read-session', id] as const,
  createMissingFile: (path: string) => ['workbench', 'create-missing-file', path] as const,
}
