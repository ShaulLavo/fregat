const BASE = 'grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden'

/** Columns of a file tab: the file (an editor, a rendered page, or both side by side) and references. */
export function fileBodyGridClass(references: boolean) {
  if (references) return `${BASE} grid-cols-[minmax(0,1fr)_minmax(260px,340px)]`
  return `${BASE} grid-cols-1`
}
