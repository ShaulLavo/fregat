/** A key the touch keyboard lacks, as the `keydown` a hardware keyboard would send the terminal. */
export type TerminalKey = {
  readonly id: string
  readonly label: string
  readonly key: string
  readonly code: string
}

export const TERMINAL_KEYS = {
  escape: { id: 'escape', label: 'Esc', key: 'Escape', code: 'Escape' },
  tab: { id: 'tab', label: 'Tab', key: 'Tab', code: 'Tab' },
  left: { id: 'left', label: 'Left', key: 'ArrowLeft', code: 'ArrowLeft' },
  up: { id: 'up', label: 'Up', key: 'ArrowUp', code: 'ArrowUp' },
  down: { id: 'down', label: 'Down', key: 'ArrowDown', code: 'ArrowDown' },
  right: { id: 'right', label: 'Right', key: 'ArrowRight', code: 'ArrowRight' },
} as const satisfies Record<string, TerminalKey>

/** The Ctrl chord for a typed character, or null for one Ctrl does not combine with. */
export function controlKeyFor(character: string): TerminalKey | null {
  const letter = character.toLowerCase()
  if (!/^[a-z]$/.test(letter)) return null

  return {
    id: `ctrl-${letter}`,
    label: `Ctrl ${letter.toUpperCase()}`,
    key: letter,
    code: `Key${letter.toUpperCase()}`,
  }
}
