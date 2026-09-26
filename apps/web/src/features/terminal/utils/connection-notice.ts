/** What a terminal whose socket is away says over its saved output. */
export function connectionNoticeText(restarting: boolean, unreachable: string | null) {
  if (restarting) return 'Server restarting. The terminal reconnects when it is back.'
  if (unreachable) return `${unreachable} is unreachable. Reconnect to use this terminal.`
  return 'Terminal connection pending. Saved output is read-only.'
}
