export const machineKeys = {
  all: ['machines'] as const,
  sshHosts: (origin: string) => [...machineKeys.all, 'ssh-hosts', origin] as const,
  tailnetHosts: (origin: string) => [...machineKeys.all, 'tailnet-hosts', origin] as const,
}

export const environmentQueryKeys = {
  descriptor: ['environment-descriptor'],
} as const

export const pickerDialogQueryKeys = {
  module: ['machine-picker-dialog', 'module'] as const,
}
