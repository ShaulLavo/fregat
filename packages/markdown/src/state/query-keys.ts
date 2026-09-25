export const markdownResourceKeys = {
  extension: (name: string) => ['markdown', 'extension', name] as const,
  core: ['highlighter', 'core'] as const,
  language: (language: string) => ['highlighter', 'language', language] as const,
}
