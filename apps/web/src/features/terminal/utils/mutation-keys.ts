export const terminalMutationKeys = {
  control: (terminalId: string) => ['terminal', 'control', terminalId] as const,
  kill: (terminalId: string) => ['terminal', 'kill', terminalId] as const,
}

export function terminalKillScope(terminalId: string) {
  return `terminal.kill:${terminalId}`
}
