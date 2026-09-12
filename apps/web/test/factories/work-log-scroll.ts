export function workLogScrollElements(heights: number[]) {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    clientHeight: { value: 100 },
    scrollHeight: { get: () => heights.reduce((total, height) => total + height, 0) },
  })
  const rows = heights.map((_, index) => {
    const row = document.createElement('div')
    row.dataset.workLogEntryId = `entry-${index}`
    row.getBoundingClientRect = () =>
      new DOMRect(
        0,
        heights.slice(0, index).reduce((total, height) => total + height, 0) - element.scrollTop,
        200,
        heights[index],
      )
    return row
  })
  element.append(...rows)
  return { element, rows }
}
