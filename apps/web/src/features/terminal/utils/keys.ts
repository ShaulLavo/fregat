export const terminalQueryKeys = {
  checkout: (rootPath: string) => ['terminal', 'checkout', rootPath] as const,
}

export const terminalMutationKeys = {
  kill: (terminalId: string) => ['terminal', 'kill', terminalId] as const,
}

export function terminalKillScope(terminalId: string) {
  return `terminal.kill:${terminalId}`
}
