import { useEffect } from 'react'

import { installLongPressContextMenu } from '@/keymap/menus/state/long-press'

/** While the phone shell is up, a long press opens context menus where the platform does not. */
export function useLongPressMenus() {
  useEffect(() => installLongPressContextMenu(), [])
}
