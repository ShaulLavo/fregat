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
  themes: ['editor', 'theme'] as const,
  theme: (id: string) => ['editor', 'theme', id] as const,
  storedHistory: (id: string) => ['editor', 'stored-history', id] as const,
  spellingSuggestions: (word: string) => ['editor', 'spelling-suggestions', word] as const,
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
