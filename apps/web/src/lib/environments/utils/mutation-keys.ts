export type MachineMutationAction = 'auth' | 'connect' | 'disconnect'

export const environmentMutationKeys = {
  all: () => ['environments'] as const,
  machine: (action: MachineMutationAction, name: string) => ['environments', action, name] as const,
}
