import { changeRowId } from '@/features/git/utils/change-row-id'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'

export type ChangesGroup = {
  expanded: boolean
  label: string
  rows: readonly ChangeRow[]
  section: PanelSection
}

type EntryBase = {
  /** The last entry of a group carries the gap that separates it from the next. */
  endsGroup: boolean
  id: string
}

export type ChangesEntry =
  | (EntryBase & { kind: 'group'; group: ChangesGroup })
  | (EntryBase & { kind: 'file'; row: ChangeRow })

/**
 * The flat row list behind the virtualized tree. A collapsed group contributes
 * its header alone, which is what makes collapsing a change of list length
 * rather than a change of what is hidden.
 */
export function changeEntries(groups: readonly ChangesGroup[]): ChangesEntry[] {
  const entries: ChangesEntry[] = []

  for (const group of groups) {
    if (group.rows.length === 0) continue

    entries.push({
      endsGroup: !group.expanded,
      group,
      id: group.section,
      kind: 'group',
    })
    if (!group.expanded) continue

    entries.push(...fileEntries(group.rows))
  }

  return entries
}

export function changeListboxItems(entries: readonly ChangesEntry[]) {
  return entries.map((entry) => {
    if (entry.kind === 'group') {
      return {
        expanded: entry.group.expanded,
        hasChildren: true,
        id: entry.id,
        label: entry.group.label,
      }
    }

    return { id: entry.id, label: entry.row.file.path, parentId: entry.row.section }
  })
}

function fileEntries(rows: readonly ChangeRow[]): ChangesEntry[] {
  return rows.map((row, index) => ({
    endsGroup: index === rows.length - 1,
    id: changeRowId(row),
    kind: 'file',
    row,
  }))
}
