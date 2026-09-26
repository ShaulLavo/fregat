import { fittedColumnWidth } from '@/features/file-picker/utils/column-widths'

/**
 * The width that shows every name in a column whole. Rows are windowed, so names are measured as
 * text in the rendered name's font, and one rendered row gives the chrome around its name.
 */
export function fitColumnWidth(scroller: HTMLElement, names: readonly string[]) {
  const name = scroller.querySelector<HTMLElement>('[data-entry-name]')
  const row = name?.closest<HTMLElement>('[role="option"]')
  const context = document.createElement('canvas').getContext('2d')
  if (!name || !row || !context) return null
  context.font = getComputedStyle(name).font
  const chrome =
    row.getBoundingClientRect().width -
    name.getBoundingClientRect().width +
    (scroller.offsetWidth - scroller.clientWidth)
  return fittedColumnWidth(
    names.map((text) => context.measureText(text).width),
    chrome,
  )
}
