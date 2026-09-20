import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type KeyboardCodes,
} from '@dnd-kit/core'
import { railKeyboardCoordinates } from '@/features/chat-mode/utils/rail-keyboard-coordinates'

/**
 * How a rail row is picked up. The rail is navigation first and a sortable list
 * second, so both sensors are deliberately hard to trigger by accident:
 *
 * - the pointer has to travel 6px before a drag starts, which leaves a plain
 *   click selecting the session or folding the band, as it always did;
 * - only Space picks a row up. dnd-kit's default also claims Enter, and Enter is
 *   how the keyboard opens the row it is standing on.
 */
const RAIL_DRAG_KEYS: KeyboardCodes = {
  cancel: ['Escape'],
  end: ['Space'],
  start: ['Space'],
}

export function useRailDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: railKeyboardCoordinates,
      keyboardCodes: RAIL_DRAG_KEYS,
    }),
  )
}
