/**
 * Numbered slots, matching the digits they are bound to. Nine of them because that is
 * how many fit on the number row; the tenth item is what next/previous are for.
 */
export const ITEM_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export type ItemPosition = (typeof ITEM_POSITIONS)[number]

export type SelectItemCommandId = `workspace.selectItem${ItemPosition}`

export type SidebarPanelCommandId = `workspace.sidebarPanel${ItemPosition}`

export function selectItemCommandId(position: ItemPosition): SelectItemCommandId {
  return `workspace.selectItem${position}`
}

export function sidebarPanelCommandId(position: ItemPosition): SidebarPanelCommandId {
  return `workspace.sidebarPanel${position}`
}
