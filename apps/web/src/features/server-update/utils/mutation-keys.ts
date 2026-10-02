export const serverUpdateMutationKeys = {
  reload: () => ['server-update', 'reload'] as const,
  restart: () => ['server-update', 'restart'] as const,
}

export const SERVER_RESTART_SCOPE = 'server-update.restart'
