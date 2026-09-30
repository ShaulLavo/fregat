export function readTerminalNamespace(): string {
  if (typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem('fregat.terminal-namespace') ?? ''
}
