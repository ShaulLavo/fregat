export const serverUpdateMutationKeys = {
  restart: () => ['server-update', 'restart'] as const,
}

export const SERVER_RESTART_SCOPE = 'server-update.restart'
