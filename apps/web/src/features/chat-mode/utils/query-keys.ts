export const sessionSearchQueryKeys = {
  all: ['chat-session-search'] as const,
  search: (query: string, limit: number) => [...sessionSearchQueryKeys.all, query, limit] as const,
}
