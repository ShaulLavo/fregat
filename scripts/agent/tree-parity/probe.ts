/**
 * Resolved geometry and colours of the file tree, as a flat `name → value` map. Runs in the page
 * through `page.evaluate`, so it references nothing outside its own body.
 *
 * `scope` is the one switch between the shadow-root tree and a light-DOM tree: the host's shadow
 * root while it has one, the host itself after. Part selectors live in `PARTS`; a rebuilt row
 * updates them there and keeps the output names.
 */
export function probeTree(): Record<string, string> {
  const PARTS = {
    row: '[data-type="item"]',
    stickyRow: '[data-file-tree-sticky-row]',
    guide: '[data-item-section="spacing-item"]',
    icon: '[data-item-section="icon"]',
    name: '[data-item-section="content"]',
    git: '[data-item-section="git"]',
    decoration: '[data-item-section="decoration"]',
    decorationAction: '[data-item-decoration-action]',
    renameInput: '[data-item-rename-input]',
    filterBar: '[data-file-tree-search-container]',
    filterInput: '[data-file-tree-search-input]',
    scroller: '[data-file-tree-virtualized-scroll]',
  }
  const host = document.querySelector<HTMLElement>('[aria-label="Folder tree"]')
  if (!host) return { error: 'no element labelled "Folder tree"' }
  const scope: ParentNode = host.shadowRoot ?? host
  const origin = host.getBoundingClientRect()
  const out: Record<string, string> = {}
  const round = (value: number) => String(Math.round(value * 100) / 100)
  const box = (element: Element | Range) => {
    const rect = element.getBoundingClientRect()
    return `${round(rect.x - origin.x)},${round(rect.y - origin.y)} ${round(rect.width)}x${round(rect.height)}`
  }
  const put = (key: string, value: string | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    out[key] = value
  }
  const styles = (
    key: string,
    element: Element | null,
    names: readonly string[],
    pseudo?: string,
  ) => {
    if (!element) return
    const computed = getComputedStyle(element, pseudo)
    for (const name of names) put(`${key}.${name}`, computed.getPropertyValue(name))
  }
  const text = (element: Element | null) => element?.textContent?.trim() ?? null
  const textBox = (element: Element | null) => {
    if (!element) return null
    const range = document.createRange()
    range.selectNodeContents(element)
    return box(range)
  }

  const ROW = [
    'background-color',
    'color',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'padding-left',
    'padding-right',
    'column-gap',
    'border-radius',
    'cursor',
  ] as const
  const PSEUDO = [
    'content',
    'outline-style',
    'outline-width',
    'outline-color',
    'outline-offset',
    'border-radius',
    'background-color',
    'left',
    'top',
    'bottom',
    'width',
  ] as const

  put('host.box', `${round(origin.width)}x${round(origin.height)}`)
  styles('host', host, ['color', 'font-family', 'font-size', 'background-color'])

  const scroller = scope.querySelector(PARTS.scroller)
  if (scroller) {
    put('scroller.box', box(scroller))
    put('scroller.scrollTop', String(Math.round(scroller.scrollTop)))
    styles('scroller', scroller, ['scrollbar-gutter', 'scrollbar-width', 'scrollbar-color'])
  }

  const filterBar = scope.querySelector(PARTS.filterBar)
  if (filterBar) {
    put('filter.box', box(filterBar))
    styles('filter', filterBar, ['background-color', 'padding-left', 'padding-right'])
  }
  const filterInput = scope.querySelector<HTMLInputElement>(PARTS.filterInput)
  if (filterInput) {
    put('filter.input.box', box(filterInput))
    put('filter.input.value', filterInput.value)
    put('filter.input.focused', String(filterInput.matches(':focus')))
    styles('filter.input', filterInput, [
      'background-color',
      'color',
      'font-family',
      'font-size',
      'border-top-width',
      'border-top-color',
      'border-radius',
      'padding-left',
      'outline-style',
      'outline-width',
      'outline-color',
      'outline-offset',
      'box-shadow',
    ])
    styles('filter.input.placeholder', filterInput, ['color'], '::placeholder')
  }

  const sticky = [...scope.querySelectorAll(PARTS.stickyRow)]
  put('sticky.count', String(sticky.length))
  for (const row of sticky) {
    const key = `sticky[${row.getAttribute('data-item-path') ?? '?'}]`
    put(`${key}.box`, box(row))
    styles(key, row, ['background-color', 'color', 'box-shadow'])
  }

  const rows = [...scope.querySelectorAll(PARTS.row)].filter((row) => !row.matches(PARTS.stickyRow))
  put('rows.count', String(rows.length))
  for (const row of rows) {
    const path = row.getAttribute('data-item-path') ?? '?'
    const key = `row[${path}]`
    put(`${key}.box`, box(row))
    put(`${key}.label`, row.getAttribute('aria-label'))
    put(`${key}.title`, row.getAttribute('title'))
    put(`${key}.selected`, row.getAttribute('aria-selected'))
    put(`${key}.expanded`, row.getAttribute('aria-expanded'))
    put(`${key}.focused`, String(row.matches(':focus')))
    styles(key, row, ROW)
    styles(`${key}::before`, row, PSEUDO, '::before')
    styles(`${key}::after`, row, PSEUDO, '::after')

    const icon = row.querySelector(PARTS.icon)
    if (icon) {
      put(`${key}.icon.box`, box(icon))
      styles(`${key}.icon`, icon, ['color', 'opacity'])
      const glyph = icon.querySelector('svg')
      if (glyph) {
        put(`${key}.icon.glyph.box`, box(glyph))
        put(`${key}.icon.glyph.href`, glyph.querySelector('use')?.getAttribute('href'))
        styles(`${key}.icon.glyph`, glyph, ['color', 'fill', 'transform'])
      }
    }

    const name = row.querySelector(PARTS.name)
    if (name) {
      put(`${key}.name.text`, text(name))
      put(`${key}.name.textBox`, textBox(name))
      styles(`${key}.name`, name, ['color', 'animation-name'])
    }

    row.querySelectorAll(PARTS.guide).forEach((guide, index) => {
      put(`${key}.guide${index}.box`, box(guide))
      styles(`${key}.guide${index}`, guide, [
        'border-left-width',
        'border-left-color',
        'opacity',
        'transition-duration',
      ])
    })

    const git = row.querySelector(PARTS.git)
    if (git) {
      put(`${key}.git.text`, text(git))
      put(`${key}.git.box`, box(git))
      styles(`${key}.git`, git, ['color', 'font-weight', 'opacity'])
      const dot = git.querySelector('svg')
      if (dot) {
        put(`${key}.git.dot.box`, box(dot))
        styles(`${key}.git.dot`, dot, ['color', 'opacity'])
      }
    }

    const decoration = row.querySelector(PARTS.decoration)
    if (decoration) {
      put(`${key}.decoration.text`, text(decoration))
      put(`${key}.decoration.box`, box(decoration))
      styles(`${key}.decoration`, decoration, ['color', 'font-size'])
    }
    const action = row.querySelector(PARTS.decorationAction)
    if (action) {
      put(`${key}.action.box`, box(action))
      styles(`${key}.action`, action, ['opacity', 'color', 'border-radius'])
    }

    const rename = row.querySelector<HTMLInputElement>(PARTS.renameInput)
    if (rename) {
      put(`${key}.rename.box`, box(rename))
      put(`${key}.rename.value`, rename.value)
      put(`${key}.rename.selection`, `${rename.selectionStart ?? ''}-${rename.selectionEnd ?? ''}`)
      styles(`${key}.rename`, rename, [
        'background-color',
        'color',
        'font-family',
        'font-size',
        'border-top-width',
        'outline-style',
        'padding-left',
        'box-shadow',
      ])
    }
  }
  return out
}

/** Lines naming every key whose value differs, is missing, or is new. */
export function diffProbes(
  baseline: Record<string, string>,
  actual: Record<string, string>,
): readonly string[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(actual)])
  const lines: string[] = []
  for (const key of [...keys].toSorted()) {
    const before = baseline[key]
    const after = actual[key]
    if (before === after) continue
    lines.push(`${key}: ${before ?? '(absent)'} → ${after ?? '(absent)'}`)
  }
  return lines
}
