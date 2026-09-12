// Consumed across features/logs/*; knip mis-reports this self-referential object const as unused.
export const logsKeys = {
  all: ['logs'] as const,
  events: (filters: unknown) => [...logsKeys.all, 'events', filters] as const,
  summary: (filters: unknown) => [...logsKeys.all, 'summary', filters] as const,
}
