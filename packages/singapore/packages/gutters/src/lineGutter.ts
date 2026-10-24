import type {
  EditorGutterContribution,
  EditorGutterRowContext,
  EditorPlugin,
} from '@singapore-editor/core/extensions'
import { normalizeNonNegativeNumber, normalizePositiveInteger, setElementHidden } from './utils'
import './lineGutter.css'

export type LineGutterPluginOptions = {
  readonly counterStyle?: string
  readonly labelForRow?: (row: EditorGutterRowContext) => LineGutterLabel
  readonly minLabelColumns?: number
  readonly minDigits?: number
  readonly minWidth?: number
  readonly startLine?: number
}

export type LineGutterLabel = number | string | null | undefined

const DEFAULT_COUNTER_STYLE = 'decimal'
const DEFAULT_LINE_GUTTER_MIN_COLUMNS = 3
const DEFAULT_LINE_GUTTER_MIN_WIDTH = 26
const DEFAULT_START_LINE = 1
const LINE_GUTTER_PADDING_PX = 8

export function createLineGutterPlugin(options: LineGutterPluginOptions = {}): EditorPlugin {
  const contribution = createLineGutterContribution(options)

  return {
    name: 'line-gutter',
    activate(context) {
      return context.registerGutterContribution(contribution)
    },
  }
}

export function createLineGutterContribution(
  options: LineGutterPluginOptions = {},
): EditorGutterContribution {
  const counterStyle = options.counterStyle ?? DEFAULT_COUNTER_STYLE
  const minLabelColumns = Math.max(
    normalizePositiveInteger(options.minLabelColumns, DEFAULT_LINE_GUTTER_MIN_COLUMNS),
    normalizePositiveInteger(options.minDigits, DEFAULT_LINE_GUTTER_MIN_COLUMNS),
  )
  const minWidth = normalizeNonNegativeNumber(options.minWidth, DEFAULT_LINE_GUTTER_MIN_WIDTH)
  const startLine = normalizePositiveInteger(options.startLine, DEFAULT_START_LINE)
  const labelForRow = options.labelForRow ?? null

  return {
    id: 'line-gutter',
    snapshotRenderer: labelForRow
      ? undefined
      : {
          key: JSON.stringify([
            'line-gutter',
            1,
            counterStyle,
            minLabelColumns,
            minWidth,
            startLine,
          ]),
          capture: captureLineGutterPaint,
          restore: restoreLineGutterPaint,
        },
    createCell(document) {
      const element = document.createElement('span')
      element.className = labelForRow
        ? 'editor-virtualized-gutter-label editor-virtualized-line-label'
        : 'editor-virtualized-gutter-label editor-virtualized-line-number'
      element.setAttribute('aria-hidden', 'true')
      if (!labelForRow) {
        element.style.setProperty('--editor-line-gutter-counter-style', counterStyle)
      }
      return element
    },
    width(context) {
      const endLine = startLine + context.lineCount - 1
      const columns = labelForRow
        ? minLabelColumns
        : Math.max(minLabelColumns, decimalDigitCount(endLine))
      return Math.max(
        minWidth,
        Math.ceil(columns * context.metrics.characterWidth + LINE_GUTTER_PADDING_PX),
      )
    },
    updateCell(element, row) {
      updateLineGutterCell(element, row, startLine, labelForRow)
    },
  }
}

function captureLineGutterPaint(element: HTMLElement): string | null {
  const counter = element.hidden ? '' : element.style.counterSet
  if (counter && !/^editor-line [0-9]+$/.test(counter)) return null
  return JSON.stringify({
    counter,
    hidden: element.hidden,
    active: element.classList.contains('editor-virtualized-line-number-active'),
  })
}

function restoreLineGutterPaint(element: HTMLElement, paint: string): boolean {
  const parsed = parseLineGutterPaint(paint)
  if (!parsed) return false
  setElementHidden(element, parsed.hidden)
  setCounterSet(element, parsed.counter)
  element.classList.toggle('editor-virtualized-line-number-active', parsed.active)
  return true
}

function parseLineGutterPaint(paint: string) {
  if (paint.length > 256) return null
  try {
    const value: unknown = JSON.parse(paint)
    if (value === null || typeof value !== 'object') return null
    if (!('counter' in value) || typeof value.counter !== 'string') return null
    if (!('hidden' in value) || typeof value.hidden !== 'boolean') return null
    if (!('active' in value) || typeof value.active !== 'boolean') return null
    if (!value.hidden && !/^editor-line [0-9]+$/.test(value.counter)) return null
    if (value.hidden && value.counter !== '') return null
    return { counter: value.counter, hidden: value.hidden, active: value.active }
  } catch {
    return null
  }
}

function updateLineGutterCell(
  element: HTMLElement,
  row: EditorGutterRowContext,
  startLine: number,
  labelForRow: ((row: EditorGutterRowContext) => LineGutterLabel) | null,
): void {
  const label = row.primaryText && labelForRow ? labelForRow(row) : null
  const hidden = !row.primaryText || (labelForRow !== null && !hasLineGutterLabel(label))
  setElementHidden(element, hidden)
  element.classList.toggle(
    'editor-virtualized-line-number-active',
    !hidden && row.cursorLine && row.cursorLineHighlight.gutterNumber,
  )
  if (hidden) {
    if (labelForRow) setTextContent(element, '')
    return
  }

  if (labelForRow) {
    setTextContent(element, String(label))
    return
  }

  setCounterSet(element, `editor-line ${startLine + row.bufferRow}`)
}

function hasLineGutterLabel(label: LineGutterLabel): boolean {
  if (label === null || label === undefined) return false
  return String(label).length > 0
}

function setCounterSet(element: HTMLElement, value: string): void {
  if (element.style.counterSet === value) return
  element.style.counterSet = value
}

function setTextContent(element: HTMLElement, value: string): void {
  if (element.textContent === value) return
  element.textContent = value
}

function decimalDigitCount(value: number): number {
  return String(Math.max(1, Math.floor(value))).length
}
