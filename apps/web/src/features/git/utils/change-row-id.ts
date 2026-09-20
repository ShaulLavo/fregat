import type { ChangeRow } from '@/features/git/utils/types'

export function changeRowId(row: ChangeRow) {
  return `${row.section}:${row.file.path}`
}
