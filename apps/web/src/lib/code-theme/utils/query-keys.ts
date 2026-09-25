export const codeThemeQueryKeys = {
  registrations: ['code-theme', 'registration'] as const,
  registration: (id: string) => ['code-theme', 'registration', id] as const,
  previewHighlighter: ['code-theme', 'preview-highlighter'] as const,
  preview: (id: string) => ['code-theme', 'preview', id] as const,
}
