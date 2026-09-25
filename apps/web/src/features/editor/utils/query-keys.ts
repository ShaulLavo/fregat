import type { SettingsValues } from '@workspace/contracts'

type LanguageServerMatchConfiguration = Pick<
  SettingsValues,
  'lsp.experimental.tyForPython' | 'lsp.languageServers' | 'lsp.servers'
>

export type LanguageServerMatchConfigurationSnapshot = {
  readonly configuration: LanguageServerMatchConfiguration
  readonly generation: number
}

export const editorQueryKeys = {
  typescriptWorkerProgram: (root: string, file: string, maxFiles: number, maxBytes: number) =>
    ['editor', 'typescript-worker', root, file, maxFiles, maxBytes] as const,
  typescriptWorkerModule: () => ['editor', 'typescript-worker-module'] as const,
  storedHistory: (id: string) => ['editor', 'stored-history', id] as const,
  languageServerMatches: (
    rootPath: string,
    matchPath: string,
    snapshot: LanguageServerMatchConfigurationSnapshot,
  ) =>
    [
      'language-server-matches',
      rootPath,
      matchPath,
      snapshot.generation,
      snapshot.configuration,
    ] as const,
}
