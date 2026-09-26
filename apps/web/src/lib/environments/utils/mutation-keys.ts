export type MachineMutationAction = 'auth' | 'connect' | 'disconnect' | 'update'

export const environmentMutationKeys = {
  all: () => ['environments'] as const,
  machine: (action: MachineMutationAction, name: string) => ['environments', action, name] as const,
}

/** Updates of one machine's server run one at a time. */
export function serverUpdateScope(name: string) {
  return { id: `machine-update:${name}` }
}
