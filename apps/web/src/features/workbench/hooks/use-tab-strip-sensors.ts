import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

export function useTabStripSensors(
  coordinateGetter: KeyboardCoordinateGetter = sortableKeyboardCoordinates,
) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    }),
  )
}
