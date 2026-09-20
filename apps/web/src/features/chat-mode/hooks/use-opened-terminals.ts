import { useState } from 'react'

export type OpenedTerminal = {
  readonly id: string
  readonly rootPath: string
}

/**
 * The session terminals the user has actually opened, in opening order. A
 * terminal spawns a shell on mount, so merely visiting a session must not add one.
 */
export function useOpenedTerminals(current: OpenedTerminal, showing: boolean) {
  const [opened, setOpened] = useState<readonly OpenedTerminal[]>([])
  const known = opened.some((terminal) => terminal.id === current.id)
  if (showing && !known) setOpened([...opened, current])

  return opened
}
