export type ShellKind = 'phone' | 'workbench'

export const COARSE_POINTER_QUERY = '(pointer: coarse)'
/** A window this narrow switches to the phone shell. */
export const PHONE_ENTER_QUERY = '(max-width: 719px)'
/** The phone shell stays until the window is this wide, so a window near the edge never flaps. */
export const PHONE_EXIT_QUERY = '(min-width: 800px)'
export const SHELL_QUERIES = [COARSE_POINTER_QUERY, PHONE_ENTER_QUERY, PHONE_EXIT_QUERY] as const

type Matches = (query: string) => boolean

/** The shell for a first paint: a touch screen or a narrow window gets the phone shell. */
export function initialShellKind(matches: Matches): ShellKind {
  return matches(COARSE_POINTER_QUERY) || matches(PHONE_ENTER_QUERY) ? 'phone' : 'workbench'
}

/** A rotated phone stays a phone: a coarse pointer never leaves the phone shell. */
export function nextShellKind(current: ShellKind, matches: Matches): ShellKind {
  if (matches(COARSE_POINTER_QUERY)) return 'phone'
  if (current === 'workbench') return matches(PHONE_ENTER_QUERY) ? 'phone' : 'workbench'
  return matches(PHONE_EXIT_QUERY) ? 'workbench' : 'phone'
}
