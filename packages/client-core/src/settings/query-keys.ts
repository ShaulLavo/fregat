export const settingsKeys = {
  all: ['settings'] as const,
  document: () => [...settingsKeys.all, 'document'] as const,
  recovery: (lifetime: string) => [...settingsKeys.all, 'recovery', lifetime] as const,
}
