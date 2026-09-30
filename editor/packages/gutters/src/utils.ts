export function setElementHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden === hidden) return
  element.hidden = hidden
}

export function addClassName(element: HTMLElement, className: string | undefined): void {
  const classNames = className?.split(/\s+/).filter(Boolean) ?? []
  if (classNames.length === 0) return
  element.classList.add(...classNames)
}

export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback
  return Math.floor(value)
}

export function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback
  return value
}
