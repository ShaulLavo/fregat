export const terminalMutationKeys = {
  kill: (terminalId: string) => ['terminal', 'kill', terminalId] as const,
}

export function terminalKillScope(terminalId: string) {
  return `terminal.kill:${terminalId}`
}
