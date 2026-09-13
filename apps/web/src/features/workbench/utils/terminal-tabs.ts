export type TerminalTabRecord = {
  /** Doubles as the server session id. */
  readonly id: string
  /** The user's rename; null shows the automatic label. */
  readonly name: string | null
  /** Foreground command other than the shell, from the server. */
  readonly process: string | null
  /** What the shell set through OSC 0/2. */
  readonly shellTitle: string | null
  readonly title: string
}

export function terminalTabLabel(tab: TerminalTabRecord) {
  return tab.name ?? tab.process ?? tab.shellTitle ?? tab.title
}

const TERMINAL_TAB_ID_PREFIX = 'terminal-'
const TERMINAL_TITLE_PATTERN = /^Terminal (\d+)$/

// Ids are never reused: the server keeps a killed session under its id until the
// PTY is gone, so a reused id would attach to the dying shell.
export function createTerminalTabRecord(
  existing: readonly TerminalTabRecord[],
  sequence: number,
): TerminalTabRecord {
  return {
    id: `${TERMINAL_TAB_ID_PREFIX}${sequence}`,
    name: null,
    process: null,
    shellTitle: null,
    title: `Terminal ${lowestFreeTerminalNumber(existing)}`,
  }
}

function lowestFreeTerminalNumber(existing: readonly TerminalTabRecord[]) {
  const taken = new Set(
    existing.map((tab) => Number(TERMINAL_TITLE_PATTERN.exec(tab.title)?.[1] ?? Number.NaN)),
  )
  let number = 1
  while (taken.has(number)) number += 1

  return number
}
