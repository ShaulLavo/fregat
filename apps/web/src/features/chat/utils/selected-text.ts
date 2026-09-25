/** The document's selected text when the whole selection sits inside `container`, else null. */
export function selectedTextWithin(container: HTMLElement): string | null {
  const selection = container.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const text = selection.toString().trim()
  return text.length > 0 ? text : null
}
