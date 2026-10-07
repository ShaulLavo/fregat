export const sessionSearchQueryKeys = {
  all: ['chat-session-search'] as const,
  search: (query: string, limit: number) => [...sessionSearchQueryKeys.all, query, limit] as const,
}

export const chatNotificationQueryKeys = {
  sound: (kind: 'input' | 'completion') => ['chat-notification-sound', kind] as const,
}

export const chatModeViewQueryKeys = {
  module: ['chat-mode', 'surfaceModule'] as const,
}
