function pickerRowElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-breadcrumb-row]'))
}

function focusAdjacentPickerRow(container: HTMLElement, step: 1 | -1) {
  const rows = pickerRowElements(container)
  if (rows.length === 0) return

  const current = rows.indexOf(document.activeElement as HTMLElement)
  const next = current < 0 ? (step > 0 ? 0 : rows.length - 1) : current + step
  rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
}

function focusFirstPickerRow(container: HTMLElement) {
  pickerRowElements(container)[0]?.focus()
}

function focusLastPickerRow(container: HTMLElement) {
  pickerRowElements(container).at(-1)?.focus()
}

function focusParentPickerRow(container: HTMLElement, row: HTMLElement) {
  const depth = Number(row.dataset.breadcrumbDepth ?? '0')
  if (depth === 0) return

  const rows = pickerRowElements(container)
  const index = rows.indexOf(row)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor]!
    if (Number(candidate.dataset.breadcrumbDepth ?? '0') < depth) {
      candidate.focus()
      return
    }
  }
}

export function handlePickerKey(
  key: string,
  container: HTMLElement,
  toggle: (path: string) => void,
): boolean {
  if (key === 'ArrowDown') {
    focusAdjacentPickerRow(container, 1)
    return true
  }
  if (key === 'ArrowUp') {
    focusAdjacentPickerRow(container, -1)
    return true
  }
  if (key === 'Home') {
    focusFirstPickerRow(container)
    return true
  }
  if (key === 'End') {
    focusLastPickerRow(container)
    return true
  }

  const row = document.activeElement
  if (!(row instanceof HTMLElement) || !row.dataset.breadcrumbPath) return false

  return handleRowKey(key, container, row, row.dataset.breadcrumbPath, toggle)
}

function handleRowKey(
  key: string,
  container: HTMLElement,
  row: HTMLElement,
  path: string,
  toggle: (path: string) => void,
) {
  const expandable = row.dataset.breadcrumbExpandable !== undefined
  const expanded = row.dataset.breadcrumbExpanded !== undefined
  if (key === 'ArrowRight') {
    if (expandable && !expanded) toggle(path)
    else focusAdjacentPickerRow(container, 1)
    return true
  }
  if (key === 'ArrowLeft') {
    if (expandable && expanded) toggle(path)
    else focusParentPickerRow(container, row)
    return true
  }
  if (key === 'Enter' || key === ' ') {
    row.click()
    return true
  }

  return false
}
