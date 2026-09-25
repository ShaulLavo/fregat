import { createContext } from 'react'

import type { PlatformKeyBinding } from '@/keymap/types'

/**
 * The effective binding table on its own. Hint badges read it per row, and the command
 * context changes with every palette keystroke.
 */
export const KeyBindingsContext = createContext<readonly PlatformKeyBinding[]>([])
