import { planRailReorder } from './reorder'

export type RailShelf = 'pinned' | 'active' | 'snoozed' | 'settled'

const RAIL_MARKER_PREFIX = 'rail-marker-'

export type RailListMarker =
  | 'pinned-header'
  | 'active-placeholder'
  | 'settled-placeholder'
  | 'pinned-divider'
  | 'snoozed-header'
  | 'settled-header'

export function railMarkerId(marker: RailListMarker): string {
  return `${RAIL_MARKER_PREFIX}${marker}`
}

export type RailListItem =
  | { readonly kind: 'session'; readonly key: string; readonly section: RailShelf }
  | { readonly kind: 'marker'; readonly marker: RailListMarker }

export function railListItemId(item: RailListItem): string {
  return item.kind === 'session' ? item.key : railMarkerId(item.marker)
}

function sectionAtRailSlot(items: readonly RailListItem[], index: number): RailShelf {
  let section: RailShelf = 'pinned'
  for (let i = 0; i < index && i < items.length; i += 1) {
    const item = items[i]!
    if (item.kind !== 'marker') continue
    if (item.marker === 'pinned-divider') section = 'active'
    else if (item.marker === 'snoozed-header') section = 'snoozed'
    else if (item.marker === 'settled-header') section = 'settled'
  }
  return section
}

export type RailDropTarget = {
  readonly section: 'pinned' | 'active' | 'settled'
  readonly pinnedOrder: readonly string[]
  readonly activeOrder: readonly string[]
}

export function resolveRailDropTarget(
  items: readonly RailListItem[],
  activeKey: string,
  overId: string,
): RailDropTarget | null {
  const activeIndex = items.findIndex((item) => railListItemId(item) === activeKey)
  const overIndex = items.findIndex((item) => railListItemId(item) === overId)
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== 'session') return null
  const moved = items.filter((_, index) => index !== activeIndex)
  moved.splice(overIndex, 0, items[activeIndex]!)
  const section = sectionAtRailSlot(moved, overIndex)
  if (section === 'snoozed') return null
  const pinnedOrder: string[] = []
  const activeOrder: string[] = []
  let currentSection: RailShelf = 'pinned'
  for (const item of moved) {
    if (item.kind === 'marker') {
      if (item.marker === 'pinned-divider') currentSection = 'active'
      else if (item.marker === 'snoozed-header' || item.marker === 'settled-header') break
    } else if (currentSection === 'pinned') pinnedOrder.push(item.key)
    else activeOrder.push(item.key)
  }
  return { section, pinnedOrder, activeOrder }
}

export type RailDropPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'reorder-pinned'
      readonly order: readonly string[]
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>
    }
  | {
      readonly kind: 'pin'
      readonly order: readonly string[]
      readonly orderKey: string | undefined
      readonly extraAssignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>
    }
  | {
      readonly kind: 'move-active'
      readonly order: readonly string[]
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>
      readonly unpin: boolean
      readonly unsettle: boolean
      readonly unsnooze: boolean
    }
  | { readonly kind: 'settle' }

export type RailDropVerb = 'pin' | 'unpin' | 'settle' | 'unsettle' | 'wake'

export function resolveRailDropVerb(from: RailShelf, to: RailShelf | null): RailDropVerb | null {
  if (to === null || to === from || to === 'snoozed') return null
  if (to === 'pinned') return 'pin'
  if (to === 'settled') return 'settle'
  if (from === 'pinned') return 'unpin'
  if (from === 'settled') return 'unsettle'
  return 'wake'
}

export function planRailDrop(input: {
  readonly activeKey: string
  readonly activeSection: RailShelf

  readonly activePinned?: boolean
  readonly activeSettled?: boolean
  readonly supportsSettlement?: boolean
  readonly target: RailDropTarget

  readonly pinnedOrder: readonly string[]
  readonly pinnedKeysById: ReadonlyMap<string, string | null | undefined>
  readonly reorderableKeys?: ReadonlySet<string>
  readonly activeOrder: readonly string[]
  readonly activeKeysById: ReadonlyMap<string, string | null | undefined>
  readonly activeReorderableKeys?: ReadonlySet<string>
}): RailDropPlan {
  const {
    activeKey,
    activeSection,
    activePinned = activeSection === 'pinned',
    activeSettled = activeSection === 'settled',
    target,
    pinnedOrder,
    pinnedKeysById,
    reorderableKeys,
    activeOrder,
    activeKeysById,
    activeReorderableKeys,
  } = input
  if (input.supportsSettlement === false && (target.section === 'settled' || activeSettled)) {
    return { kind: 'none' }
  }
  switch (target.section) {
    case 'active': {
      const order = target.activeOrder
      if (
        activeSection === 'active' &&
        order.length === activeOrder.length &&
        order.every((key, index) => key === activeOrder[index])
      ) {
        return { kind: 'none' }
      }
      const assignments = planRailReorder({
        orderedIds: order,
        keysById: activeKeysById,
        movedId: activeKey,
      })
      if (activeReorderableKeys && assignments.some(({ id }) => !activeReorderableKeys.has(id))) {
        return { kind: 'none' }
      }
      return {
        kind: 'move-active',
        order,
        assignments,
        unpin: activePinned,
        unsettle: activeSettled,
        unsnooze: activeSection === 'snoozed',
      }
    }
    case 'settled':
      return activeSection === 'settled' ? { kind: 'none' } : { kind: 'settle' }
    case 'pinned': {
      const order = target.pinnedOrder
      if (
        activeSection === 'pinned' &&
        order.length === pinnedOrder.length &&
        order.every((key, index) => key === pinnedOrder[index])
      ) {
        return { kind: 'none' }
      }
      const assignments = planRailReorder({
        orderedIds: order,
        keysById: pinnedKeysById,
        movedId: activeKey,
      })
      if (reorderableKeys && assignments.some(({ id }) => !reorderableKeys.has(id))) {
        return { kind: 'none' }
      }
      if (activeSection === 'pinned') {
        return assignments.length === 0
          ? { kind: 'none' }
          : { kind: 'reorder-pinned', order, assignments }
      }
      return {
        kind: 'pin',
        order,
        orderKey: assignments.find((assignment) => assignment.id === activeKey)?.orderKey,
        extraAssignments: activePinned
          ? assignments
          : assignments.filter((assignment) => assignment.id !== activeKey),
      }
    }
  }
}
