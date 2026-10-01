export const workbenchMutationKeys = {
  loadCsvPresentation: () => ['workbench', 'load-csv-presentation'] as const,
  loadCsvEngine: () => ['workbench', 'load-csv-engine'] as const,
  releaseReadSession: (id: string) => ['workbench', 'release-read-session', id] as const,
  createMissingFile: (path: string) => ['workbench', 'create-missing-file', path] as const,
}
