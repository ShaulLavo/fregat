const BASE = 'grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden'

/** Columns of a file tab: the editor, a rendered markdown pane, a references pane. */
export function fileBodyGridClass(markdownPreview: boolean, references: boolean) {
  if (markdownPreview && references)
    return `${BASE} grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(260px,340px)]`
  if (markdownPreview) return `${BASE} grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`
  if (references) return `${BASE} grid-cols-[minmax(0,1fr)_minmax(260px,340px)]`
  return `${BASE} grid-cols-1`
}
